import { AdvanceRadioRequest, CreateRadioStationRequest, Permission, RadioOfflineRequest, SetChannelRadioRequest, SetRadioPlaybackRequest, twitchChannelOf, UpdateRadioStationRequest, youtubePlaylistOf, youtubeVideoOf, type RadioPlayback } from "@squorli/protocol";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import { canIn, channelActor, resolveChannel } from "../channelGuard";
import type { Db } from "../db";
import { channels, radioStations } from "../db/schema";
import type { Hub } from "../hub";
import { pickPlayable } from "../radio/queue";
import { resolveStreamUrl } from "../radio/resolve";
import { lookupYoutube } from "../radio/youtube";
import { broadcastStructure, loadSettings, radioHostOf } from "../state";
import { compact } from "../util";
import type { VoicePresence } from "../voice/presence";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;
const MAX_STATIONS = 200;
/** Everything that says "a radio is on"; also what the idle stop (index.ts) writes. */
export const RADIO_OFF = { radioStationId: null, radioStreamUrl: null, radioName: null, radioStartedBy: null, radioPlayback: null, radioQueue: null };
const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * Web radio. The station list belongs to the server (MANAGE_SERVER); tuning a voice channel to a station or turning the
 * radio off needs CONTROL_RADIO. The audio never passes through here: clients play `streamUrl` themselves, the server
 * only reads a station's playlist when the radio is started (radio/resolve.ts).
 */
/** `onRadioChange`: whatever changed what a channel plays, the "now playing" reader (radio/metadata.ts) follows. */
export async function registerRadioRoutes(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence, onRadioChange: () => void) {
  /** Channels whose queue is being moved on right now: every listener's player reports the end of a video at the same moment. */
  const advancing = new Set<string>();
  // ---- Stations
  app.post("/api/radio/stations", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    const body = CreateRadioStationRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    if ((await db.$count(radioStations)) >= MAX_STATIONS) return reply.code(409).send({ error: "too_many_stations" });
    const [row] = await db.insert(radioStations).values(body.data).returning({ id: radioStations.id, name: radioStations.name, url: radioStations.url });
    await broadcastStructure(db, hub, ["radioStations"]);
    onRadioChange();
    return row;
  });

  app.patch<{ Params: { id: string } }>("/api/radio/stations/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    const body = UpdateRadioStationRequest.safeParse(req.body);
    if (!body.success || Object.keys(compact(body.data)).length === 0) return reply.code(400).send({ error: "bad_request" });
    const [before] = await db.select({ url: radioStations.url }).from(radioStations).where(eq(radioStations.id, req.params.id)).limit(1);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const [row] = await db.update(radioStations).set(compact(body.data)).where(eq(radioStations.id, req.params.id)).returning({ id: radioStations.id, name: radioStations.name, url: radioStations.url });
    if (!row) return reply.code(404).send({ error: "not_found" });
    // A new address: channels still playing the old one are turned off instead of silently switching what everyone hears.
    if (row.url !== before.url) await db.update(channels).set(RADIO_OFF).where(eq(channels.radioStationId, row.id));
    await broadcastStructure(db, hub, ["radioStations", "channels"]); // channels carry the station's name
    onRadioChange();
    return row;
  });

  app.delete<{ Params: { id: string } }>("/api/radio/stations/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    await db.update(channels).set(RADIO_OFF).where(eq(channels.radioStationId, req.params.id));
    const gone = await db.delete(radioStations).where(eq(radioStations.id, req.params.id)).returning({ id: radioStations.id });
    if (!gone.length) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["radioStations", "channels"]);
    onRadioChange();
    return { ok: true };
  });

  // ---- Radio of a voice channel
  app.put<{ Params: { id: string } }>("/api/channels/:id/radio", { schema: { params: Params } }, async (req, reply) => {
    const m = await channelActor(db, req, reply, req.params.id, "voice");
    if (!m) return;
    if (!canIn(m.perms, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    if (!m.channel.allowRadio) return reply.code(409).send({ error: "radio_disabled" });
    const body = SetChannelRadioRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    // Nobody hears anything in the AFK channel, so it has no radio.
    if ((await loadSettings(db)).afkChannelId === req.params.id) return reply.code(409).send({ error: "afk_channel" });
    // Either one of the server's stations or an address typed in by the member (CONTROL_RADIO covers both, user's decision).
    let source: { stationId: string | null; url: string; name: string | null };
    if ("stationId" in body.data) {
      const [station] = await db.select().from(radioStations).where(eq(radioStations.id, body.data.stationId)).limit(1);
      if (!station) return reply.code(404).send({ error: "unknown_station" });
      source = { stationId: station.id, url: station.url, name: null };
    } else {
      source = { stationId: null, url: body.data.url, name: radioHostOf(body.data.url) };
    }
    // A YouTube playlist is played as a queue kept here. Its videos come with the request: the sender's client read them from
    // YouTube's player, the server has no key to ask YouTube with. Without them a playlist address that names a video plays
    // that video alone (an older client), one that names none cannot be played.
    const list = youtubePlaylistOf(source.url);
    if (list && body.data.videoIds) {
      const videoIds = body.data.videoIds;
      const first = await pickPlayable(videoIds, Math.max(0, list.videoId ? videoIds.indexOf(list.videoId) : 0), 1, lookupYoutube);
      if (!first) return reply.code(502).send({ error: "radio_unknown_video" });
      const videoId = videoIds[first.index]!;
      const start = videoId === list.videoId ? youtubeVideoOf(source.url)?.start ?? 0 : 0;
      const [queued] = await db.update(channels).set({ radioStationId: source.stationId, radioStreamUrl: watchUrl(videoId), radioName: source.stationId === null ? first.title ?? source.name : null, radioStartedBy: m.actor.userId,
        radioPlayback: { playing: true, position: start, rate: 1, at: Date.now() }, radioQueue: { listId: list.listId, videoIds, index: first.index } })
        .where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).returning({ id: channels.id });
      if (!queued) return reply.code(404).send({ error: "not_found" });
      await broadcastStructure(db, hub, ["channels"]);
      onRadioChange();
      return { ok: true, streamUrl: watchUrl(videoId) };
    }
    if (list && !list.videoId) return reply.code(400).send({ error: "radio_playlist_unresolved" });
    const resolved = await resolveStreamUrl(source.url);
    if (!resolved.ok) return reply.code(502).send({ error: `radio_${resolved.error}` });
    // A YouTube video: its title as the name of a typed address, and it starts playing for everyone at the address's offset.
    const youtube = youtubeVideoOf(source.url);
    let playback: RadioPlayback | null = null;
    if (youtube) {
      const video = await lookupYoutube(youtube.videoId);
      if (!video.ok) return reply.code(502).send({ error: `radio_${video.error}` });
      if (source.stationId === null && video.title) source.name = video.title;
      playback = { playing: true, position: youtube.start, rate: 1, at: Date.now() };
    }
    const [row] = await db.update(channels).set({ radioStationId: source.stationId, radioStreamUrl: resolved.streamUrl, radioName: source.name, radioStartedBy: m.actor.userId, radioPlayback: playback, radioQueue: null })
      .where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).returning({ id: channels.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["channels"]);
    onRadioChange();
    return { ok: true, streamUrl: resolved.streamUrl };
  });

  /**
   * Play, pause, move: a member with CONTROL_RADIO did that in their player, everyone's player follows (YouTube sources
   * only). The server only stamps the time; the state goes out as its own small event, because dragging the player's
   * progress bar sends several of these, and stays on the channel for whoever connects later.
   */
  app.put<{ Params: { id: string } }>("/api/channels/:id/radio/playback", { schema: { params: Params } }, async (req, reply) => {
    const m = await channelActor(db, req, reply, req.params.id, "voice");
    if (!m) return;
    if (!canIn(m.perms, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const body = SetRadioPlaybackRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [channel] = await db.select({ url: channels.radioStreamUrl }).from(channels).where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).limit(1);
    if (!channel) return reply.code(404).send({ error: "not_found" });
    if (!channel.url || !youtubeVideoOf(channel.url)) return reply.code(409).send({ error: "no_playback" });
    const playback: RadioPlayback = { ...body.data, at: Date.now() };
    // Only while it is still the same source: a radio changed in the meantime keeps its own state.
    const [row] = await db.update(channels).set({ radioPlayback: playback }).where(and(eq(channels.id, req.params.id), eq(channels.radioStreamUrl, channel.url))).returning({ id: channels.id });
    if (!row) return reply.code(409).send({ error: "no_playback" });
    hub.broadcastToChannel(row.id, { type: "radio.playback", channelId: row.id, playback });
    return { ok: true, playback };
  });

  /**
   * On to the next video of the queue (or back). Two senders: a member with CONTROL_RADIO skips, and every listener's player
   * reports when the video is over (`ended`), for which sitting in the voice channel is enough: the server cannot know
   * when a video ends (no API key, oEmbed names no length), and a queue that only moves on while a member with the
   * permission listens would be no radio. What such a report can do at worst is skip the running video. `from` names the
   * video the sender means: all players report the same end, only the first report moves the queue.
   */
  app.post<{ Params: { id: string } }>("/api/channels/:id/radio/advance", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const body = AdvanceRadioRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const { from, step, ended } = body.data;
    const r = await resolveChannel(db, m.userId, req.params.id, "voice");
    if (!r) return reply.code(404).send({ error: "not_found" });
    const allowed = ended ? step === 1 && presence.channelOfUser(m.actor.userId) === req.params.id : canIn(r.perms, Permission.CONTROL_RADIO);
    if (!allowed) return reply.code(403).send({ error: "forbidden" });
    const [channel] = await db.select({ url: channels.radioStreamUrl, queue: channels.radioQueue, stationId: channels.radioStationId }).from(channels).where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).limit(1);
    if (!channel) return reply.code(404).send({ error: "not_found" });
    const queue = channel.queue;
    // A radio with nothing left to play turns itself off (user's wish, 20 September 2026): a single video that ended ...
    if (channel.url && !queue && ended) {
      if (youtubeVideoOf(channel.url)?.videoId !== from) return { ok: true, moved: false };
      return { ok: true, moved: false, stopped: await turnOff(req.params.id, channel.url) };
    }
    if (!channel.url || !queue) return reply.code(409).send({ error: "no_queue" });
    if (queue.videoIds[queue.index] !== from || advancing.has(req.params.id)) return { ok: true, moved: false };
    advancing.add(req.params.id);
    try {
      // ... or the last video of a queue. Only a skip by hand goes around the ends of the list.
      const next = await pickPlayable(queue.videoIds, queue.index + step, step, lookupYoutube, !ended);
      if (!next && ended) return { ok: true, moved: false, stopped: await turnOff(req.params.id, channel.url) };
      if (!next) return reply.code(502).send({ error: "radio_unknown_video" });
      const url = watchUrl(queue.videoIds[next.index]!);
      // A typed address is named after its video; a station keeps its name. Only while it is still the same video: a radio changed during the lookup keeps what it got.
      const [row] = await db.update(channels).set({ radioStreamUrl: url, radioQueue: { ...queue, index: next.index }, radioPlayback: { playing: true, position: 0, rate: 1, at: Date.now() }, ...(channel.stationId === null ? { radioName: next.title ?? radioHostOf(url) } : {}) })
        .where(and(eq(channels.id, req.params.id), eq(channels.radioStreamUrl, channel.url))).returning({ id: channels.id });
      if (!row) return { ok: true, moved: false };
      await broadcastStructure(db, hub, ["channels"]);
      onRadioChange();
      return { ok: true, moved: true };
    } finally { advancing.delete(req.params.id); }
  });

  /** The radio has nothing left to play: off, unless it plays something else by now. */
  async function turnOff(channelId: string, url: string): Promise<boolean> {
    const [row] = await db.update(channels).set(RADIO_OFF).where(and(eq(channels.id, channelId), eq(channels.radioStreamUrl, url))).returning({ id: channels.id });
    if (!row) return false;
    await broadcastStructure(db, hub, ["channels"]);
    onRadioChange();
    return true;
  }

  // A Twitch stream that is over (AdvanceRadioRequest's counterpart, protocol RadioOfflineRequest): told by the player of a
  // member who sits in the channel, or by someone who may control the radio. The server has no way to ask Twitch itself.
  app.post<{ Params: { id: string } }>("/api/channels/:id/radio/offline", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    const body = RadioOfflineRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const r = await resolveChannel(db, m.userId, req.params.id, "voice");
    if (!r) return reply.code(404).send({ error: "not_found" });
    if (presence.channelOfUser(m.actor.userId) !== req.params.id && !canIn(r.perms, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const [channel] = await db.select({ url: channels.radioStreamUrl }).from(channels).where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).limit(1);
    if (!channel) return reply.code(404).send({ error: "not_found" });
    if (!channel.url || twitchChannelOf(channel.url)?.toLowerCase() !== body.data.channel.toLowerCase()) return { ok: true, stopped: false };
    return { ok: true, stopped: await turnOff(req.params.id, channel.url) };
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id/radio", { schema: { params: Params } }, async (req, reply) => {
    const m = await channelActor(db, req, reply, req.params.id, "voice");
    if (!m) return;
    if (!canIn(m.perms, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const [row] = await db.update(channels).set(RADIO_OFF).where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).returning({ id: channels.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["channels"]);
    onRadioChange();
    return { ok: true };
  });
}

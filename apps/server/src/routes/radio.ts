import { CreateRadioStationRequest, Permission, SetChannelRadioRequest, SetRadioPlaybackRequest, UpdateRadioStationRequest, youtubeVideoOf, type RadioPlayback } from "@squorli/protocol";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { channels, radioStations } from "../db/schema";
import type { Hub } from "../hub";
import { resolveStreamUrl } from "../radio/resolve";
import { lookupYoutube } from "../radio/youtube";
import { broadcastStructure, radioHostOf } from "../state";
import { compact } from "../util";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;
const MAX_STATIONS = 200;
/** Everything that says "a radio is on"; also what the idle stop (index.ts) writes. */
export const RADIO_OFF = { radioStationId: null, radioStreamUrl: null, radioName: null, radioStartedBy: null, radioPlayback: null };

/**
 * Web radio. The station list belongs to the server (MANAGE_SERVER); tuning a voice channel to a station or turning the
 * radio off needs CONTROL_RADIO. The audio never passes through here: clients play `streamUrl` themselves, the server
 * only reads a station's playlist when the radio is started (radio/resolve.ts).
 */
/** `onRadioChange`: whatever changed what a channel plays, the "now playing" reader (radio/metadata.ts) follows. */
export async function registerRadioRoutes(app: FastifyInstance, db: Db, hub: Hub, onRadioChange: () => void) {
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
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const body = SetChannelRadioRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    // Either one of the server's stations or an address typed in by the member (CONTROL_RADIO covers both, user's decision).
    let source: { stationId: string | null; url: string; name: string | null };
    if ("stationId" in body.data) {
      const [station] = await db.select().from(radioStations).where(eq(radioStations.id, body.data.stationId)).limit(1);
      if (!station) return reply.code(404).send({ error: "unknown_station" });
      source = { stationId: station.id, url: station.url, name: null };
    } else {
      source = { stationId: null, url: body.data.url, name: radioHostOf(body.data.url) };
    }
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
    const [row] = await db.update(channels).set({ radioStationId: source.stationId, radioStreamUrl: resolved.streamUrl, radioName: source.name, radioStartedBy: m.actor.userId, radioPlayback: playback })
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
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const body = SetRadioPlaybackRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [channel] = await db.select({ url: channels.radioStreamUrl }).from(channels).where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).limit(1);
    if (!channel) return reply.code(404).send({ error: "not_found" });
    if (!channel.url || !youtubeVideoOf(channel.url)) return reply.code(409).send({ error: "no_playback" });
    const playback: RadioPlayback = { ...body.data, at: Date.now() };
    // Only while it is still the same source: a radio changed in the meantime keeps its own state.
    const [row] = await db.update(channels).set({ radioPlayback: playback }).where(and(eq(channels.id, req.params.id), eq(channels.radioStreamUrl, channel.url))).returning({ id: channels.id });
    if (!row) return reply.code(409).send({ error: "no_playback" });
    hub.broadcast({ type: "radio.playback", channelId: row.id, playback });
    return { ok: true, playback };
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id/radio", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const [row] = await db.update(channels).set(RADIO_OFF).where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).returning({ id: channels.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["channels"]);
    onRadioChange();
    return { ok: true };
  });
}

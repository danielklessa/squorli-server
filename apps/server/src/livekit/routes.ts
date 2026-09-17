import { Permission, RtcTokenRequest, displayNameOf, type RtcTokenResponse } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Config } from "../config";
import type { Db } from "../db";
import { channels } from "../db/schema";
import { loadSettings } from "../state";

/**
 * The app server decides who may enter which room and issues a
 * short-lived LiveKit token for it. Media then flows directly client <-> LiveKit.
 * Room name = channel id. Permission: member with CONNECT_VOICE and VIEW_CHANNELS.
 * Camera and screen (including screen audio as its own track, PLAN 3.6) only with STREAM_VIDEO;
 * LiveKit enforces this via canPublishSources, not just the client.
 * The AFK channel (server setting) gets a token without publish and subscribe grants: nobody sends or hears anything
 * in it, whatever the client does; participants still see who is there.
 */
export async function registerLivekitRoutes(app: FastifyInstance, db: Db, config: Config) {
  app.post("/api/rtc-token", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.CONNECT_VOICE) || !can(m.actor, Permission.VIEW_CHANNELS)) return reply.code(403).send({ error: "forbidden" });

    const body = RtcTokenRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [channel] = await db.select().from(channels).where(eq(channels.id, body.data.channelId)).limit(1);
    if (!channel || channel.kind !== "voice") return reply.code(404).send({ error: "unknown_channel" });

    const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
      identity: m.userId,
      name: displayNameOf(m),
      ttl: "10m",
    });
    const sources = [TrackSource.MICROPHONE];
    if (can(m.actor, Permission.STREAM_VIDEO)) sources.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
    const afk = (await loadSettings(db)).afkChannelId === channel.id;
    // canUpdateOwnMetadata: the client reports "audio off" as a participant attribute so others can see it.
    at.addGrant(afk
      ? { roomJoin: true, room: channel.id, canPublish: false, canSubscribe: false, canPublishData: false, canUpdateOwnMetadata: true }
      : { roomJoin: true, room: channel.id, canPublish: true, canPublishSources: sources, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: true });

    const res: RtcTokenResponse = { url: config.livekitPublicUrl, token: await at.toJwt() };
    return res;
  });
}

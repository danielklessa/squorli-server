import { Permission, RtcTokenRequest, displayNameOf, type RtcTokenResponse } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Config } from "../config";
import type { Db } from "../db";
import { channels } from "../db/schema";

/**
 * Der App-Server entscheidet, wer in welchen Raum darf, und stellt dafuer ein
 * kurzlebiges LiveKit-Token aus. Medien laufen danach direkt Client <-> LiveKit.
 * Raumname = Kanal-ID. Recht: Mitglied mit CONNECT_VOICE und VIEW_CHANNELS.
 * Kamera und Bildschirm (inkl. Bildschirm-Ton als eigener Track, PLAN 3.6) nur mit STREAM_VIDEO;
 * LiveKit setzt das ueber canPublishSources durch, nicht nur der Client.
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
    // canUpdateOwnMetadata: der Client meldet "Ton aus" als Teilnehmer-Attribut, damit andere es sehen.
    at.addGrant({ roomJoin: true, room: channel.id, canPublish: true, canPublishSources: sources, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: true });

    const res: RtcTokenResponse = { url: config.livekitPublicUrl, token: await at.toJwt() };
    return res;
  });
}

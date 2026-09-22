import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config";

/**
 * Moderation directly at LiveKit (M3): mute a participant's camera/screen server-side and
 * change publish permissions at runtime. The client additionally receives a WS event so its interface
 * follows along; enforcement happens here, though, regardless of whether the client cooperates.
 * All calls are best effort: if the participant is not (or no longer) in the room, nothing happens.
 */
export class LivekitAdmin {
  private readonly svc: RoomServiceClient;
  private snapshot: { at: number; rooms: Promise<Map<string, string> | null> } | null = null;
  constructor(config: Config, private readonly log: FastifyBaseLogger) {
    this.svc = new RoomServiceClient(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  }

  /**
   * Who sits in which room right now (identity = user id, room = channel id), for putting voice presence back after a
   * restart or a reconnect (voice/presence.ts). One listing serves everybody who asks within 3 s (after a restart all
   * clients come back at once). null = LiveKit did not answer: the caller changes nothing then.
   */
  roomsByIdentity(): Promise<Map<string, string> | null> {
    if (this.snapshot && Date.now() - this.snapshot.at < 3000) return this.snapshot.rooms;
    const rooms = (async () => {
      try {
        const out = new Map<string, string>();
        for (const room of await this.svc.listRooms()) {
          if (room.numParticipants === 0) continue;
          for (const p of await this.svc.listParticipants(room.name)) out.set(p.identity, room.name);
        }
        return out;
      } catch (err) {
        this.log.debug({ err }, "livekit roomsByIdentity: LiveKit nicht erreichbar");
        return null;
      }
    })();
    this.snapshot = { at: Date.now(), rooms };
    return rooms;
  }

  /** Mute a participant's camera and/or screen tracks (including screen audio). */
  async stopStreams(room: string, identity: string, what: { camera: boolean; screen: boolean }): Promise<void> {
    try {
      const p = await this.svc.getParticipant(room, identity);
      const wanted = new Set<TrackSource>();
      if (what.camera) wanted.add(TrackSource.CAMERA);
      if (what.screen) { wanted.add(TrackSource.SCREEN_SHARE); wanted.add(TrackSource.SCREEN_SHARE_AUDIO); }
      for (const t of p.tracks) if (wanted.has(t.source) && !t.muted) await this.svc.mutePublishedTrack(room, identity, t.sid, true);
    } catch (err) {
      this.log.debug({ err, room, identity }, "livekit stopStreams: Teilnehmer nicht im Raum oder LiveKit nicht erreichbar");
    }
  }

  /** Set publish permissions at runtime: microphone only, or microphone + camera + screen. */
  async setCanStream(room: string, identity: string, allowed: boolean): Promise<void> {
    const sources = allowed
      ? [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
      : [TrackSource.MICROPHONE];
    try {
      await this.svc.updateParticipant(room, identity, { permission: { canPublish: true, canSubscribe: true, canPublishData: false, canUpdateMetadata: true, canPublishSources: sources } });
    } catch (err) {
      this.log.debug({ err, room, identity }, "livekit setCanStream: Teilnehmer nicht im Raum oder LiveKit nicht erreichbar");
    }
  }

  /**
   * The room became the AFK channel while this participant sits in it: no sending and no receiving from now on (LiveKit
   * unpublishes their tracks). Whoever joins later gets a token without these grants (livekit/routes.ts); the way back
   * when the room stops being the AFK channel is setCanStream.
   */
  async silence(room: string, identity: string): Promise<void> {
    try {
      await this.svc.updateParticipant(room, identity, { permission: { canPublish: false, canSubscribe: false, canPublishData: false, canUpdateMetadata: true, canPublishSources: [] } });
    } catch (err) {
      this.log.debug({ err, room, identity }, "livekit silence: Teilnehmer nicht im Raum oder LiveKit nicht erreichbar");
    }
  }

  /** Drop a participant from a room: the same account joined voice from another client (ws/handler.ts, 22 September 2026). */
  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.svc.removeParticipant(room, identity);
    } catch (err) {
      this.log.debug({ err, room, identity }, "livekit removeParticipant: Teilnehmer nicht im Raum oder LiveKit nicht erreichbar");
    }
  }
}

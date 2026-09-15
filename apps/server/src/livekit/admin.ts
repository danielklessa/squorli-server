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
  constructor(config: Config, private readonly log: FastifyBaseLogger) {
    this.svc = new RoomServiceClient(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
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
}

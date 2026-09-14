import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config";

/**
 * Moderation direkt bei LiveKit (M3): Kamera/Bildschirm eines Teilnehmers serverseitig stummschalten und
 * Publish-Rechte zur Laufzeit aendern. Der Client bekommt zusaetzlich ein WS-Ereignis, damit seine Oberflaeche
 * mitzieht; durchgesetzt wird es aber hier, unabhaengig davon, ob der Client mitspielt.
 * Alle Aufrufe sind best effort: ist der Teilnehmer nicht (mehr) im Raum, passiert nichts.
 */
export class LivekitAdmin {
  private readonly svc: RoomServiceClient;
  constructor(config: Config, private readonly log: FastifyBaseLogger) {
    this.svc = new RoomServiceClient(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  }

  /** Kamera- und/oder Bildschirmspuren (inkl. Bildschirm-Ton) eines Teilnehmers stummschalten. */
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

  /** Publish-Rechte zur Laufzeit setzen: nur Mikrofon, oder Mikrofon + Kamera + Bildschirm. */
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

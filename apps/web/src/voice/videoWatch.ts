/**
 * Which video feeds of others the user watches (user's requirement, 19 September 2026): a camera is watched until the user
 * turns it off for themselves, a screen share only once the user turns it on. A choice is kept in memory only and ends with
 * the feed (a share started again has to be turned on again) and with the voice connection. Feed id = `<identity>:camera`
 * or `<identity>:screen`, as in `VideoTile.id`.
 */
export type VideoSource = "camera" | "screen";

export const feedId = (identity: string, source: VideoSource) => `${identity}:${source}`;

/** Splits a feed id; the identity may contain colons itself, the source never does. */
export function parseFeedId(id: string): { identity: string; source: VideoSource } {
  const cut = id.lastIndexOf(":");
  return { identity: id.slice(0, cut), source: id.slice(cut + 1) === "screen" ? "screen" : "camera" };
}

export class VideoWatch {
  private readonly choice = new Map<string, boolean>();

  watching(identity: string, source: VideoSource): boolean {
    return this.choice.get(feedId(identity, source)) ?? source === "camera";
  }
  set(identity: string, source: VideoSource, on: boolean): void { this.choice.set(feedId(identity, source), on); }
  /** The feed ended (unpublished): the next one starts from the default again. */
  forget(identity: string, source: VideoSource): void { this.choice.delete(feedId(identity, source)); }
  forgetParticipant(identity: string): void { this.forget(identity, "camera"); this.forget(identity, "screen"); }
  clear(): void { this.choice.clear(); }
}

/**
 * Tile view, option "hide participants without video": it only counts while at least one video is being sent in the
 * channel (a camera, a screen, or the radio's player tile); without any, every tile is shown.
 */
export function videoActive(participants: readonly { cameraOn: boolean; screenOn: boolean }[], playerTile: boolean): boolean {
  return playerTile || participants.some((p) => p.cameraOn || p.screenOn);
}

/**
 * What to do with the camera track that already exists when the camera is switched on (again).
 *
 * Why (user's report, 19 September 2026: "wenn ich eine Standardkamera ausgewählt habe wird immer diese genommen, auch wenn
 * ich in dem Dialog eine andere Kamera wähle"): a camera switched off is a MUTED track that stays published (voice/AGENTS.md).
 * LiveKit's `setCameraEnabled(true, options)` then only unmutes that track and reopens it with the constraints it was
 * created with; the options, and so the camera picked in the dialog, are ignored. The first camera of a connection stuck
 * for as long as the connection lasted. The same happened to a changed send resolution while the camera ran.
 *
 * Pure logic (tested); `VoiceClient.setCameraEnabled()` acts on the answer.
 */
export type CameraRequest = { deviceId: string | null; quality: "360p" | "720p" };

export type CameraSwitch =
  /** No track yet, or the same camera as before: LiveKit's own path (create, or unmute) is right. */
  | "enable"
  /** A switched-off track of another camera or resolution: unpublish it, so that the camera is opened fresh with the new choice. */
  | "republish"
  /** The camera runs and something changed: restart the running track with the new constraints (no new publication). */
  | "restart";

export function cameraSwitch(existing: { muted: boolean; opened: CameraRequest | null } | null, wanted: CameraRequest): CameraSwitch {
  if (!existing) return "enable";
  const o = existing.opened;
  // A track we did not open ourselves (opened = null) is of unknown origin: treat it as different.
  // `null` as the wanted device means "whatever the browser picks" and is satisfied by any open camera.
  const same = o !== null && o.quality === wanted.quality && (wanted.deviceId === null || wanted.deviceId === o.deviceId);
  if (same) return "enable";
  return existing.muted ? "republish" : "restart";
}

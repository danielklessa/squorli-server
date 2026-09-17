/** Fullscreen must be requested on the element's own document (which may be a pop-out). */
export async function toggleVideoFullscreen(element: {
  requestFullscreen?: () => Promise<void>;
  ownerDocument: { fullscreenElement: unknown; exitFullscreen: () => Promise<void> };
}): Promise<boolean> {
  if (element.ownerDocument.fullscreenElement) await element.ownerDocument.exitFullscreen();
  else if (element.requestFullscreen) await element.requestFullscreen();
  else return false;
  return true;
}

/** Detach only this view, never stop the shared track or detach the other windows. */
export function attachVideoView<T>(track: { attach: (element: T) => unknown; detach: (element: T) => unknown }, element: T) {
  track.attach(element);
  return () => { track.detach(element); };
}
/**
 * Stop receiving a video nobody can see, decided per window. LiveKit's own rule (adaptiveStream `pauseVideoInBackground`)
 * only looks at the MAIN page: five seconds after that is hidden (another tab, minimized, or on Windows completely covered
 * by other windows) it pauses every received video, also one that is showing in a pop-out window, perhaps in fullscreen on
 * a second monitor (user's report: "manchmal bleibt ein Screenshare hängen, wenn er ausgepoppt oder im Vollbild ist"). So
 * that rule is turned off (voiceClient.ts) and each video view detaches itself while ITS OWN document has been hidden for
 * a while: a track without an attached element is paused by adaptiveStream, one that still shows in a visible window plays on.
 * Calls `onChange(true)` once the document has been hidden for `delayMs`, `onChange(false)` as soon as it is visible again.
 */
export const HIDDEN_PAUSE_DELAY_MS = 5000;
export function watchDocumentHidden(doc: { hidden: boolean; addEventListener: (type: "visibilitychange", fn: () => void) => void; removeEventListener: (type: "visibilitychange", fn: () => void) => void },
  onChange: (hiddenForLong: boolean) => void, delayMs = HIDDEN_PAUSE_DELAY_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reported = false;
  const report = (value: boolean) => { if (value !== reported) { reported = value; onChange(value); } };
  const update = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (doc.hidden) timer = setTimeout(() => { timer = null; report(true); }, delayMs);
    else report(false);
  };
  update();
  doc.addEventListener("visibilitychange", update);
  return () => { if (timer !== null) clearTimeout(timer); doc.removeEventListener("visibilitychange", update); };
}

/** Fit the video content within the available space, preserving its aspect ratio. */
export function fitVideoWindow(ratio: number, preferredWidth: number, maxWidth: number, maxHeight: number) {
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const width = Math.max(1, Math.min(preferredWidth, maxWidth, maxHeight * aspect));
  return { width: Math.round(width), height: Math.max(1, Math.round(width / aspect)) };
}

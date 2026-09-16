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
/** Fit the video content within the available space, preserving its aspect ratio. */
export function fitVideoWindow(ratio: number, preferredWidth: number, maxWidth: number, maxHeight: number) {
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const width = Math.max(1, Math.min(preferredWidth, maxWidth, maxHeight * aspect));
  return { width: Math.round(width), height: Math.max(1, Math.round(width / aspect)) };
}

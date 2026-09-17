/**
 * Opening a camera can fail although nothing is wrong with it: Firefox releases a stopped camera asynchronously and
 * cannot share one with another process, so opening it again right after `stop()` (camera picker preview -> channel,
 * off -> on) fails with `AbortError: Starting videoinput failed` (user's report, 18 September 2026). Chrome shares the
 * device and never sees this. One retry after a short pause covers the release; a camera held by another program
 * (a video call in another browser, a conferencing app) fails the retry too and is reported as busy.
 */
export const CAMERA_RETRY_MS = 600;

/** The device could not be started: held by another program, or not yet released by the browser. */
export const isCameraBusy = (err: unknown) => {
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  return name === "AbortError" || name === "NotReadableError";
};

export async function retryCameraBusy<T>(open: () => Promise<T>, delayMs = CAMERA_RETRY_MS, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<T> {
  try { return await open(); } catch (err) {
    if (!isCameraBusy(err)) throw err;
    await wait(delayMs);
    return open();
  }
}

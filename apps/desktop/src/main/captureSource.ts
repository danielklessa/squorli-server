/**
 * What a desktopCapturer source id says. Pure (tested), no Electron import.
 * A window's id is "window:<hwnd>:<n>" on Windows; the native audio helper and the check for the app's own windows need the handle.
 */
export function hwndOfSource(id: string): string | null {
  const m = /^window:(\d{1,20}):\d+$/.exec(id);
  return m ? m[1]! : null;
}

/** A window handle as Electron hands it out (`getNativeWindowHandle()`, a little-endian buffer) as the decimal string of a source id. */
export function hwndOfHandle(handle: Uint8Array): string {
  let value = 0n;
  for (let i = Math.min(handle.length, 8) - 1; i >= 0; i--) value = (value << 8n) | BigInt(handle[i]!);
  return value.toString();
}

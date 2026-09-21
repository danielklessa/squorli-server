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

/**
 * What the system watch helper says about a window (Windows): its window class, whether it is a tool window (one the task
 * bar and Alt+Tab leave out), its program's full path ("" = the process does not say) and whether it covers its whole monitor
 * without being maximized (a game or a player in full screen; false from a helper that does not say).
 */
export type WindowInfo = { hwnd: string; tool: boolean; className: string; path: string; fullscreen: boolean };

/**
 * A window nobody shares, which the picker leaves out (user's report, 21 September 2026: every Rainmeter skin was offered):
 * desktop widgets. They are tool windows; Rainmeter's are named as well, in case a skin is set up differently.
 */
export function isDesktopWidget(info: WindowInfo): boolean {
  return info.tool || info.className === "RainmeterMeterWindow" || /(^|[\\/])rainmeter\.exe$/i.test(info.path);
}

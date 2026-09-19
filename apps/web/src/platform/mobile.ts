/**
 * Is this a phone or a tablet? (19 September 2026, user's wish: recognise mobile devices and adapt audio and video to them.)
 *
 * This is about the DEVICE, not the layout: `App.tsx` switches to the narrow layout by window width, which a small desktop
 * window has too. A phone differs in what it captures and what it can send: its microphone arrives far quieter (an iPhone
 * never reached the voice activation threshold), it has a front and a rear camera, it encodes on a battery over a mobile
 * connection, and its browsers have no screen share. What follows from it: `voice/micBoost.ts` (limits of the boost),
 * `voice/settings.ts` (defaults applied once), `videoDisplay.ts` (rear camera not mirrored).
 *
 * Pure function plus one reader of `navigator`, without any other import, so the voice settings can use it in tests.
 */
export type DeviceHints = {
  userAgent: string;
  /** `navigator.maxTouchPoints`: tells an iPad apart, which calls itself a Mac in its user agent. */
  maxTouchPoints: number;
  /** `navigator.userAgentData.mobile` where the browser has it (Chromium); undefined elsewhere. */
  uaDataMobile?: boolean | undefined;
};

export function isMobileDevice(hints: DeviceHints): boolean {
  if (hints.uaDataMobile === true) return true;
  if (/Android|iPhone|iPad|iPod/.test(hints.userAgent)) return true;
  // iPadOS asks for the desktop site by default and then reports "Macintosh"; no Mac has a touch screen.
  return /Macintosh/.test(hints.userAgent) && hints.maxTouchPoints > 1;
}

/** Reads the running browser; false where there is none (tests, the desktop app never is one). */
export function detectMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return isMobileDevice({ userAgent: navigator.userAgent ?? "", maxTouchPoints: navigator.maxTouchPoints ?? 0, uaDataMobile: uaData?.mobile });
}

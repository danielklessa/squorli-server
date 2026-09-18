// COPY NOTE: also exists byte-identically in the squorli-directory repo (packages/protocol/src); the source is squorli-server, copy it over after any change.
/**
 * Device label derived from the user agent (M6c): "Chrome on Windows", "Safari on iOS". Deliberately coarse and dependency-free;
 * it only serves recognition in the device list. It lives in the protocol package because both chat server and directory service need it.
 * The desktop app names itself (`Squorli-Desktop/<version>`, apps/desktop); it is checked first, because its user agent also
 * carries Chrome's token.
 */
export function labelFromUserAgent(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const browser =
    /\bSquorli-Desktop\/\d/.test(ua) ? "Squorli Desktop"
    : /\bEdg(?:e|A|iOS)?\/\d/.test(ua) ? "Edge"
    : /\bOPR\/\d|\bOpera\b/.test(ua) ? "Opera"
    : /\bFirefox\/\d|\bFxiOS\/\d/.test(ua) ? "Firefox"
    : /\bChrome\/\d|\bCriOS\/\d/.test(ua) ? "Chrome"
    : /\bSafari\/\d/.test(ua) && /\bVersion\/\d/.test(ua) ? "Safari"
    : "Browser";
  const os =
    /\bAndroid\b/.test(ua) ? "Android"
    : /\biPhone\b|\biPad\b|\biPod\b/.test(ua) ? "iOS"
    : /\bWindows NT\b/.test(ua) ? "Windows"
    : /\bMac OS X\b/.test(ua) ? "macOS"
    : /\bCrOS\b/.test(ua) ? "ChromeOS"
    : /\bLinux\b/.test(ua) ? "Linux"
    : null;
  return os ? `${browser} auf ${os}` : browser;
}

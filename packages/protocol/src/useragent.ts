// KOPIE-HINWEIS: liegt byte-identisch auch im Repo squorli-directory (packages/protocol/src); Quelle ist squorli-server, nach Aenderung kopieren.
/**
 * Geraetebezeichnung aus dem User-Agent (M6c): "Chrome auf Windows", "Safari auf iOS". Bewusst grob und ohne Abhaengigkeit;
 * dient nur der Wiedererkennung in der Geraeteliste. Liegt im Protokollpaket, weil Chat-Server und Verzeichnisdienst es brauchen.
 */
export function labelFromUserAgent(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const browser =
    /\bEdg(?:e|A|iOS)?\/\d/.test(ua) ? "Edge"
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

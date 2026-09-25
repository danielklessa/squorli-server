import { detectMobile } from "./mobile";
import type { Platform, PlatformOs } from "./types";

export function osFromUserAgent(ua: string): PlatformOs {
  if (/Windows NT/.test(ua)) return "windows";
  if (/Android|iPhone|iPad|iPod/.test(ua)) return "other";
  if (/Mac OS X/.test(ua)) return "macos";
  if (/Linux|CrOS/.test(ua)) return "linux";
  return "other";
}

export const popoutFeatures = (size: { width: number; height: number }) => `popup,width=${size.width},height=${size.height},resizable=yes,scrollbars=no`;

/** The browser: the page is served by a chat server, which is the home server and names the directory. */
export function webPlatform(): Platform {
  // Development only: `VITE_HOMELESS=1 pnpm --filter @squorli/web dev` runs the client as the desktop app would, without a
  // home server and against the local directory, so that mode can be tried in a browser (docs/features/desktop.md).
  const homeless = import.meta.env.DEV && import.meta.env.VITE_HOMELESS === "1";
  const mobile = detectMobile();
  return {
    kind: "web",
    os: osFromUserAgent(navigator.userAgent),
    mobile,
    app: null,
    home: homeless ? null : { host: window.location.host, signDomain: window.location.hostname },
    systemIdle: "permission",
    secretStore: null,
    systemActivity: null,
    games: null,
    hotkeys: null,
    defaultDirectoryUrl: homeless ? (import.meta.env.VITE_DIRECTORY_URL as string | undefined) ?? "http://localhost:3100" : null,
    setLanguage: null,
    media: { mobile, blocksInsecureMedia: window.location.protocol === "https:", screenSharePublishOverrides: () => null, takeScreenAudio: async () => null, stopScreenAudio: () => {}, setPlayerOutput: null, setChatPlayerOutput: null },
    links: {
      openExternal: (url) => { window.open(url, "_blank", "noopener"); },
      onDeepLink: () => () => {},
      lookUp: null,
    },
    screen: { setPicker: () => {} },
    window: { popoutFeatures, appearance: null, tray: null, autostart: null, ready: () => {}, attention: null, frame: null },
    updates: null,
  };
}

import type { DesktopBridge } from "./bridge";
import { desktopPlatform } from "./desktop";
import type { Platform } from "./types";
import { webPlatform } from "./web";

export type * from "./types";

declare global {
  interface Window { squorliDesktop?: DesktopBridge }
}

/** The platform of this page: the desktop app when its preload script left a bridge, the browser otherwise. */
export const platform: Platform = window.squorliDesktop ? desktopPlatform(window.squorliDesktop) : webPlatform();

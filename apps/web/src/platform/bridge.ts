/**
 * Contract between the desktop shell (Electron, `apps/desktop`) and the client. The preload script exposes one
 * `DesktopBridge` as `window.squorliDesktop`; `desktop.ts` turns it into the client's `Platform`.
 * DOM-free: the Electron main process and the preload script import these types (package export `./platform/bridge`).
 * Everything that crosses the bridge is plain data (structured clone); no functions except the bridge's own members.
 */

export type PlatformOs = "windows" | "linux" | "macos" | "other";

/** Window background of the desktop app: a system material behind the client plus how opaque the client's surfaces are. */
export type WindowMaterial = "none" | "mica" | "acrylic";
export type WindowAppearance = { material: WindowMaterial; opacity: number };
export const WINDOW_OPACITY_MIN = 0.4;

export type UpdateState =
  | { status: "unsupported" }
  | { status: "idle"; checkedAt: number | null }
  | { status: "checking" }
  /** manual = this package cannot update itself (deb); the client links to the download page instead. */
  | { status: "available"; version: string; manual: boolean }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

/** One thing the desktop app can share (a screen or a window); thumbnail and icon are data URLs. */
export type ScreenSource = { id: string; kind: "screen" | "window"; name: string; thumbnail: string; icon: string | null };
export type ScreenPickRequest = { requestId: number; sources: ScreenSource[]; canShareAudio: boolean };
export type ScreenPick = { sourceId: string; audio: boolean };

/** Fixed facts about the running app, handed to the preload script at window creation. */
export type DesktopInfo = {
  version: string;
  electron: string;
  chrome: string;
  os: PlatformOs;
  /** Directory the app uses (https://directory.squorli.com; development builds may override it). */
  directoryUrl: string;
  /** Materials this system offers besides "none"; empty = the appearance setting is not shown. */
  materials: WindowMaterial[];
  appearance: WindowAppearance;
  update: UpdateState;
};

export interface DesktopBridge {
  readonly info: DesktopInfo;
  openExternal(url: string): void;
  /** Raw `squorli://` links; the first subscription also delivers the link the app was started with. */
  onDeepLink(cb: (raw: string) => void): () => void;
  /** The shell asks which screen or window to share; answer with `answerScreenPick` (null = cancelled). */
  onScreenPickRequest(cb: (request: ScreenPickRequest) => void): () => void;
  answerScreenPick(requestId: number, pick: ScreenPick | null): void;
  setAppearance(appearance: WindowAppearance): Promise<WindowAppearance>;
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  checkForUpdates(): void;
  restartAndInstall(): void;
}

/** IPC channel names, shared by main and preload. */
export const IPC = {
  openExternal: "squorli:open-external",
  deepLinkReady: "squorli:deep-link-ready",
  deepLink: "squorli:deep-link",
  screenPickRequest: "squorli:screen-pick-request",
  screenPickAnswer: "squorli:screen-pick-answer",
  setAppearance: "squorli:set-appearance",
  updateState: "squorli:update-state",
  updateCheck: "squorli:update-check",
  updateInstall: "squorli:update-install",
} as const;

/** Name of the global the preload script exposes, and of the argument that carries `DesktopInfo` (base64 JSON). */
export const BRIDGE_GLOBAL = "squorliDesktop";
export const INFO_ARGUMENT = "--squorli-info=";

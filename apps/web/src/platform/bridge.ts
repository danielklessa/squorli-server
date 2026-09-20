/**
 * Contract between the desktop shell (Electron, `apps/desktop`) and the client. The preload script exposes one
 * `DesktopBridge` as `window.squorliDesktop`; `desktop.ts` turns it into the client's `Platform`.
 * DOM-free: the Electron main process and the preload script import these types (package export `./platform/bridge`).
 * Everything that crosses the bridge is plain data (structured clone); no functions except the bridge's own members.
 */

export type PlatformOs = "windows" | "linux" | "macos" | "other";

/**
 * Window background of the desktop app (user's decision, 18 September 2026): "none" = opaque, "mica" = Windows 11's material
 * behind the whole window (Windows turns it solid while the window is inactive), "clear" = a really see-through window: the gaps
 * between the client's areas show the desktop, the areas are tinted surfaces. `opacity` = how opaque those surfaces are.
 * A window is created see-through or not, so changing to or from "clear" takes effect after a restart of the app.
 */
export type WindowMaterial = "none" | "mica" | "clear";
export type WindowAppearance = { material: WindowMaterial; opacity: number };
export const WINDOW_OPACITY_MIN = 0.4;
/** What is stored, what the running window actually shows, and whether a restart is pending to get there. */
export type AppearanceState = { appearance: WindowAppearance; effective: WindowMaterial; needsRestart: boolean };

/** The window has no system title bar; the client draws its own (TitleBar.tsx) and needs to know this much. */
export type WindowFrameState = { maximized: boolean; focused: boolean; fullscreen: boolean };
export type WindowControl = "minimize" | "toggle-maximize" | "close";

export type UpdateState =
  | { status: "unsupported" }
  | { status: "idle"; checkedAt: number | null }
  | { status: "checking" }
  /** manual = this package cannot update itself (deb); the client links to the download page instead. */
  | { status: "available"; version: string; manual: boolean }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

/**
 * One thing the desktop app can share (a screen or a window); thumbnail and icon are data URLs. `audio` = audio can go with
 * it: for a window what its application plays, for a screen what the system plays (without the app itself where the shell
 * has its native capture helper; the app's own windows never carry audio).
 */
export type ScreenSource = { id: string; kind: "screen" | "window"; name: string; thumbnail: string; icon: string | null; audio: boolean };
export type ScreenPickRequest = { requestId: number; sources: ScreenSource[] };
export type ScreenPick = { sourceId: string; audio: boolean };
/** Audio the shell captures itself for a screen share (Windows, native helper): PCM 48 kHz, 16 bit signed, interleaved stereo. */
export type ScreenAudioEvent = { type: "start" } | { type: "data"; pcm: Uint8Array } | { type: "end" };

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
  /** The shell captures a share's audio itself (native helper present); then a picked source with audio arrives through `onScreenAudio`. */
  nativeScreenAudio: boolean;
  appearance: AppearanceState;
  frame: WindowFrameState;
  /** The app has a tray icon; `closeToTray` = the window's close button hides the window instead of quitting (user's setting). null = no tray. */
  tray: { closeToTray: boolean } | null;
  /**
   * Start with the system (user's setting, off by default). null = this app cannot (unpackaged, or a system without a known
   * way); missing = an app older than the setting.
   */
  autostart?: { enabled: boolean; /** A start by the system stays in the background (tray or minimized) instead of opening the window; missing = an app that always does. */ background?: boolean } | null;
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
  onScreenAudio(cb: (event: ScreenAudioEvent) => void): () => void;
  stopScreenAudio(): void;
  /** Output device of the embedded players (Twitch, YouTube), named by its label because device ids differ per origin; null = the system's default. */
  setPlayerOutput(label: string | null): void;
  setAppearance(appearance: WindowAppearance): Promise<AppearanceState>;
  /** Restart the app (a pending change of the window background). */
  relaunch(): void;
  windowControl(action: WindowControl): void;
  setCloseToTray(on: boolean): Promise<boolean>;
  /** Start the app when the user signs in to the system; answers with what is set now. */
  setAutostart(on: boolean): Promise<boolean>;
  /** Whether a start by the system stays in the background (true) or opens the window (false); answers with what is set now. */
  setAutostartBackground(on: boolean): Promise<boolean>;
  /** How many direct messages and mentions wait (0 = none): the mark on the task bar icon and the tray icon. */
  setAttention(count: number): void;
  onWindowFrame(cb: (state: WindowFrameState) => void): () => void;
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
  screenAudio: "squorli:screen-audio",
  screenAudioStop: "squorli:screen-audio-stop",
  playerOutput: "squorli:player-output",
  setAppearance: "squorli:set-appearance",
  relaunch: "squorli:relaunch",
  windowControl: "squorli:window-control",
  windowFrame: "squorli:window-frame",
  setCloseToTray: "squorli:set-close-to-tray",
  setAutostart: "squorli:set-autostart",
  setAutostartBackground: "squorli:set-autostart-background",
  attention: "squorli:attention",
  updateState: "squorli:update-state",
  updateCheck: "squorli:update-check",
  updateInstall: "squorli:update-install",
} as const;

/** Name of the global the preload script exposes, and of the argument that carries `DesktopInfo` (base64 JSON). */
export const BRIDGE_GLOBAL = "squorliDesktop";
export const INFO_ARGUMENT = "--squorli-info=";

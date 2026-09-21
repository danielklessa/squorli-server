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
 * has its native capture helper; the app's own windows never carry audio). `gameId` = the window belongs to a detected game
 * (its id as in `RunningGame`; shell from 21 September 2026, only while game detection is on). `fullscreen` = the window
 * covers its whole monitor without being maximized (a game or a player in full screen).
 */
export type ScreenSource = { id: string; kind: "screen" | "window"; name: string; thumbnail: string; icon: string | null; audio: boolean; gameId?: string | null; fullscreen?: boolean };
export type ScreenPickRequest = { requestId: number; sources: ScreenSource[] };
/** The video codec a share is sent with: "vp8" = the client's standing codec, "h264" = the user's choice for moving pictures (games). */
export type ScreenCodec = "vp8" | "h264";
/** `codec` stays in the client (the publish options of the share); the shell reads `sourceId` and `audio` only. */
export type ScreenPick = { sourceId: string; audio: boolean; codec?: ScreenCodec };
/** Audio the shell captures itself for a screen share (Windows, native helper): PCM 48 kHz, 16 bit signed, interleaved stereo. */
export type ScreenAudioEvent = { type: "start" } | { type: "data"; pcm: Uint8Array } | { type: "end" };

/**
 * What the shell's native system watch helper sees outside the window (Windows): `input` = a game controller was used (at most
 * once a second; Chromium's Gamepad API only delivers while the window has the focus), `display` = whether some program asks
 * the system to keep the display on, which browsers and players do while a video plays. docs/features/afk.md.
 */
export type SystemActivityEvent = { type: "input" } | { type: "display"; required: boolean };

/**
 * Game detection of the desktop app (docs/features/games.md): the shell reads which games the launchers installed and its
 * native helper tells when a program from one of those folders, or one the user added, is in front. Everything stays on
 * this computer so far. An id is the launcher's own ("steam:730", "epic:<app name>", "gog:<id>", "xbox:<store id>") or
 * "custom:<path>" for an added program; install paths stay in the shell.
 */
export type GameSource = "steam" | "epic" | "gog" | "xbox" | "custom";
export type DetectedGame = { id: string; name: string; source: GameSource; /** The game's icon as the computer itself has it, a small PNG as a data URL (shell from 21 September 2026); null or left out = none. */ icon?: string | null };
export type RunningGame = { id: string; name: string };
/** A program the user added by hand: the full path of its executable and the name to show. */
export type CustomProgram = { path: string; name: string };
/** What the shell needs from the client's settings: whether to detect at all, and the added programs. */
export type GameWatchSettings = { enabled: boolean; custom: CustomProgram[] };

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
  /** The shell runs its system watch helper (`onSystemActivity`); missing = an app older than it. */
  systemWatch?: boolean;
  /** The shell can detect running games (system watch helper present, a platform whose launchers it reads); missing = an app older than it. */
  gameDetection?: boolean;
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
  /**
   * The same for the players of videos linked in the chat (LinkPreviews.tsx), which follow the output device of screen share
   * audio, not the radio's. The shell tells the two kinds of player frames apart by CHAT_PLAYER_MARK. An app from before it
   * has no such member and puts every player on the radio's device.
   */
  setChatPlayerOutput(label: string | null): void;
  /** Controller input and the "display required" state; the first subscription also gets the current display state. */
  onSystemActivity(cb: (event: SystemActivityEvent) => void): () => void;
  /** Read the launchers' installed games again; answers with them and the added programs, by name. */
  scanGames(): Promise<DetectedGame[]>;
  /**
   * Look a link up for the preview of a direct message: the app asks the linked host itself (public hosts only), so no
   * server learns the link. An app from before it has no such member; the client then asks the directory like a browser.
   */
  lookUpLink(request: { url: string } | { youtube: string }): Promise<BridgeLinkLookup>;
  setGameWatch(settings: GameWatchSettings): void;
  /** Ask the user for a program to add (the system's file dialog); null = cancelled. */
  pickGameProgram(): Promise<CustomProgram | null>;
  /** The game in front last that still runs, null = none; the first subscription gets the current one. */
  onRunningGame(cb: (game: RunningGame | null) => void): () => void;
  setAppearance(appearance: WindowAppearance): Promise<AppearanceState>;
  /** Restart the app (a pending change of the window background). */
  relaunch(): void;
  windowControl(action: WindowControl): void;
  setCloseToTray(on: boolean): Promise<boolean>;
  /** Start the app when the user signs in to the system; answers with what is set now. */
  setAutostart(on: boolean): Promise<boolean>;
  /** Whether a start by the system stays in the background (true) or opens the window (false); answers with what is set now. */
  setAutostartBackground(on: boolean): Promise<boolean>;
  /** The client knows what its first screen is: the shell's start window makes way for the main window. */
  clientReady(): void;
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
  chatPlayerOutput: "squorli:chat-player-output",
  systemActivity: "squorli:system-activity",
  systemActivityReady: "squorli:system-activity-ready",
  gamesScan: "squorli:games-scan",
  linkLookup: "squorli:link-lookup",
  gamesWatch: "squorli:games-watch",
  gamesPick: "squorli:games-pick",
  gameRunning: "squorli:game-running",
  gameRunningReady: "squorli:game-running-ready",
  setAppearance: "squorli:set-appearance",
  relaunch: "squorli:relaunch",
  windowControl: "squorli:window-control",
  windowFrame: "squorli:window-frame",
  setCloseToTray: "squorli:set-close-to-tray",
  setAutostart: "squorli:set-autostart",
  setAutostartBackground: "squorli:set-autostart-background",
  attention: "squorli:attention",
  clientReady: "squorli:client-ready",
  updateState: "squorli:update-state",
  updateCheck: "squorli:update-check",
  updateInstall: "squorli:update-install",
} as const;

/** Name of the global the preload script exposes, and of the argument that carries `DesktopInfo` (base64 JSON). */
export const BRIDGE_GLOBAL = "squorliDesktop";
export const INFO_ARGUMENT = "--squorli-info=";

/** What a link lookup found: the fields of a preview and the picture as it came from the host (the client makes it small). */
export type BridgeLinkLookup =
  | { found: false }
  | { found: true; kind: "page" | "youtube"; siteName: string | null; title: string | null; description: string | null; image: { mime: string; data: Uint8Array } | null };

/**
 * Fragment of a chat video's player address (`https://www.youtube-nocookie.com/embed/<id>?...#squorli-chat`). A fragment
 * never reaches YouTube; the desktop shell reads it from the frame's address to give that player the chat's output device.
 */
export const CHAT_PLAYER_MARK = "#squorli-chat";

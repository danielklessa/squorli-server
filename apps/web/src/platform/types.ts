import type { AppearanceState, CustomProgram, DetectedGame, GameWatchSettings, PlatformOs, RunningGame, ScreenPick, ScreenSource, SystemActivityEvent, UpdateState, WindowAppearance, WindowControl, WindowFrameState, WindowMaterial } from "./bridge";
import type { DeepLink } from "./deepLink";

export type { DeepLink } from "./deepLink";
export type { AppearanceState, CustomProgram, DetectedGame, GameWatchSettings, PlatformOs, RunningGame, ScreenPick, ScreenSource, SystemActivityEvent, UpdateState, WindowAppearance, WindowControl, WindowFrameState, WindowMaterial } from "./bridge";

/** The chat server that serves the page: its key in the store and the domain a login there signs. */
export type PlatformHome = { host: string; signDomain: string };

/** Asks the user which screen or window to share; null = cancelled. */
export type ScreenPicker = (sources: ScreenSource[]) => Promise<ScreenPick | null>;

/** What the voice core needs from the platform (handed to `VoiceClient`, which imports no platform module). */
export interface PlatformMedia {
  /** A phone or tablet (platform/mobile.ts): its microphone arrives far quieter, so the boost gets wider limits (voice/micBoost.ts). */
  readonly mobile: boolean;
  /** The page may not load http/ws resources (https page, desktop app); only changes what hints say. */
  readonly blocksInsecureMedia: boolean;
  /** Publish options that replace the client's defaults for a screen share (codec test on the desktop); null = none. */
  screenSharePublishOverrides(): { videoCodec?: "vp8" | "h264" | "vp9" | "av1"; backupCodec?: boolean } | null;
  /**
   * Right after a screen share started: the audio track the platform captured itself for it (desktop app on Windows: one
   * window's audio, or the system's without the app), or null = none (the share's own audio track, if any, applies).
   */
  takeScreenAudio(): Promise<MediaStreamTrack | null>;
  /** The share ended: end the platform's capture. */
  stopScreenAudio(): void;
  /**
   * Where the embedded players (Twitch, YouTube as the radio's source) play: the output device's LABEL (device ids differ
   * per origin), null = the system's default. Only the desktop app can do that (its shell reaches into the player's frame);
   * a browser page cannot route a foreign iframe's sound, there it is null and the players use the default device.
   */
  readonly setPlayerOutput: ((label: string | null) => void) | null;
}

/**
 * Where the client runs. One build serves both: the browser (served by a chat server) and the desktop app (the same files
 * from `app://squorli`, recognised by the bridge of its preload script). Everything that differs between the two goes
 * through this interface; components import the singleton from `./platform`, the UI-free cores (`Store`, `VoiceClient`)
 * take what they need as constructor options.
 */
export interface Platform {
  readonly kind: "web" | "desktop";
  readonly os: PlatformOs;
  /** A phone or tablet, told by the device and not by the window's width (platform/mobile.ts); the desktop app never is one. */
  readonly mobile: boolean;
  /** Desktop: versions for the settings; web: null (the server's version is shown). */
  readonly app: { version: string; electron: string; chrome: string } | null;
  /** The server that serves the page; null = none (desktop app: the client starts from the directory account). */
  readonly home: PlatformHome | null;
  /** Directory to use when there is no home server to name one. */
  readonly defaultDirectoryUrl: string | null;
  /**
   * AFK detection across the whole system (idleDetection.ts). "permission": a browser grants it only inside a click, so it is
   * a switch in the settings; "always": the desktop shell grants it by itself, it simply runs and there is no switch.
   */
  readonly systemIdle: "permission" | "always";
  /**
   * What only the desktop app's shell sees (its native helper, Windows): controller input, which the browser's Gamepad API
   * delivers only while the window has the focus, and whether some program keeps the display on (a playing video);
   * systemActivity.ts. null = nothing of the kind (browser, an app without the helper or older than it).
   */
  readonly systemActivity: null | { subscribe(cb: (event: SystemActivityEvent) => void): () => void };
  /**
   * Game detection (gameDetection.ts, docs/features/games.md): the desktop app's shell reads the launchers' installed games
   * and says which one is in front; null = not available (browser, an app without the helper or older than the feature).
   */
  readonly games: null | {
    scan(): Promise<DetectedGame[]>;
    setWatch(settings: GameWatchSettings): void;
    /** The system's file dialog for a program to add; null = cancelled. */
    pickProgram(): Promise<CustomProgram | null>;
    subscribe(cb: (game: RunningGame | null) => void): () => void;
  };
  readonly media: PlatformMedia;
  readonly links: {
    /** Open an address outside the client (desktop: the system's browser). */
    openExternal(url: string): void;
    /** `squorli://` links aimed at this app; the first subscription also delivers the one the app was started with. */
    onDeepLink(cb: (link: DeepLink) => void): () => void;
  };
  readonly screen: {
    /** Desktop: the shell has no picker of its own and asks this one; web: ignored (the browser brings its own). */
    setPicker(picker: ScreenPicker | null): void;
  };
  readonly window: {
    /** Feature string for `window.open` of a video pop-out. */
    popoutFeatures(size: { width: number; height: number }): string;
    /** Window background (desktop); null = not available. `state()` also says what the running window shows and whether a restart is pending. */
    readonly appearance: null | { readonly materials: readonly WindowMaterial[]; state(): AppearanceState; set(appearance: WindowAppearance): Promise<AppearanceState>; restart(): void };
    /** Tray icon of the desktop app: whether closing the window only hides it there; null = no tray. */
    readonly tray: null | { closeToTray(): boolean; setCloseToTray(on: boolean): Promise<boolean> };
    /** Start the desktop app with the system; null = not available (browser, unpackaged app, an app older than the setting). */
    readonly autostart: null | {
      enabled(): boolean; set(on: boolean): Promise<boolean>;
      /** How a start by the system looks: in the background (tray, or minimized where closing quits) or with the window opened; null = this app cannot be told (it always starts in the background). */
      readonly background: null | { get(): boolean; set(on: boolean): Promise<boolean> };
    };
    /** The first screen is decided (login, or the servers are known): the desktop app's start window makes way. Nothing to do in a browser. */
    ready(): void;
    /** Mark on the app's task bar and tray icon: how many direct messages and mentions wait; null = no such mark (browser, older app). */
    readonly attention: null | { set(count: number): void };
    /** The window has no system title bar and the client draws its own (desktop); null = the browser's or system's frame. */
    readonly frame: null | { state(): WindowFrameState; subscribe(cb: (state: WindowFrameState) => void): () => void; control(action: WindowControl): void };
  };
  /** App updates (desktop); null = the page is updated by its server. */
  readonly updates: null | { get(): UpdateState; subscribe(cb: (state: UpdateState) => void): () => void; check(): void; restartAndInstall(): void };
}

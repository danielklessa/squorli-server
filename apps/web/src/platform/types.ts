import type { AppearanceState, PlatformOs, ScreenPick, ScreenSource, UpdateState, WindowAppearance, WindowControl, WindowFrameState, WindowMaterial } from "./bridge";
import type { DeepLink } from "./deepLink";

export type { DeepLink } from "./deepLink";
export type { AppearanceState, PlatformOs, ScreenPick, ScreenSource, UpdateState, WindowAppearance, WindowControl, WindowFrameState, WindowMaterial } from "./bridge";

/** The chat server that serves the page: its key in the store and the domain a login there signs. */
export type PlatformHome = { host: string; signDomain: string };

/** Asks the user which screen or window to share; null = cancelled. */
export type ScreenPicker = (sources: ScreenSource[]) => Promise<ScreenPick | null>;

/** What the voice core needs from the platform (handed to `VoiceClient`, which imports no platform module). */
export interface PlatformMedia {
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
    /** The window has no system title bar and the client draws its own (desktop); null = the browser's or system's frame. */
    readonly frame: null | { state(): WindowFrameState; subscribe(cb: (state: WindowFrameState) => void): () => void; control(action: WindowControl): void };
  };
  /** App updates (desktop); null = the page is updated by its server. */
  readonly updates: null | { get(): UpdateState; subscribe(cb: (state: UpdateState) => void): () => void; check(): void; restartAndInstall(): void };
}

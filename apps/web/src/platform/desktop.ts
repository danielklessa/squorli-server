import type { AppearanceState, DesktopBridge, UpdateState, WindowFrameState } from "./bridge";
import { parseDeepLink } from "./deepLink";
import { screenAudio } from "./screenAudio";
import type { Platform, ScreenPicker } from "./types";
import { popoutFeatures } from "./web";

/** The desktop app: no home server, the directory is fixed, and the shell (Electron main process) does what a browser would. */
export function desktopPlatform(bridge: DesktopBridge): Platform {
  const info = bridge.info;

  const audio = screenAudio(bridge);
  let picker: ScreenPicker | null = null;
  bridge.onScreenPickRequest((request) => {
    const answer = picker ? picker(request.sources).catch(() => null) : Promise.resolve(null);
    void answer.then((pick) => {
      // With the native helper the shell captures the audio itself and sends it over; the voice client takes it after the share started.
      audio.expect(!!pick?.audio && info.nativeScreenAudio);
      bridge.answerScreenPick(request.requestId, pick);
    });
  });

  let look: AppearanceState = info.appearance;
  // The page follows the window as it really is (`effective`): with mica or a see-through window the body lets it through and
  // the surfaces take the chosen opacity (styles.css). The own title bar needs its height reserved (modals start below it).
  const paint = () => {
    const root = document.documentElement;
    if (look.effective === "none") { delete root.dataset.material; root.style.removeProperty("--win-alpha"); }
    else { root.dataset.material = look.effective; root.style.setProperty("--win-alpha", String(look.appearance.opacity)); }
  };
  paint();
  document.documentElement.dataset.desktop = info.os;

  let closeToTray = info.tray?.closeToTray ?? false;
  let autostart = info.autostart?.enabled ?? false;
  let autostartBackground = info.autostart?.background ?? true;
  let frame: WindowFrameState = info.frame;
  const frameListeners = new Set<(state: WindowFrameState) => void>();
  bridge.onWindowFrame((state) => { frame = state; for (const fn of frameListeners) fn(state); });

  let update: UpdateState = info.update;
  const updateListeners = new Set<(state: UpdateState) => void>();
  bridge.onUpdateState((state) => { update = state; for (const fn of updateListeners) fn(state); });

  return {
    kind: "desktop",
    os: info.os,
    mobile: false,
    app: { version: info.version, electron: info.electron, chrome: info.chrome },
    home: null,
    defaultDirectoryUrl: info.directoryUrl,
    systemIdle: "always",
    // app:// is a secure scheme; only the development window (Vite over http) may load http resources.
    media: { mobile: false, blocksInsecureMedia: window.location.protocol !== "http:", screenSharePublishOverrides: () => null, takeScreenAudio: () => audio.take(), stopScreenAudio: () => audio.stop(),
      // An app older than this client has no such member.
      setPlayerOutput: typeof bridge.setPlayerOutput === "function" ? (label) => bridge.setPlayerOutput(label) : null },
    links: {
      openExternal: (url) => bridge.openExternal(url),
      onDeepLink: (cb) => bridge.onDeepLink((raw) => { const link = parseDeepLink(raw); if (link) cb(link); }),
    },
    screen: { setPicker: (next) => { picker = next; } },
    window: {
      popoutFeatures,
      appearance: info.materials.length === 0 ? null : {
        materials: info.materials,
        state: () => look,
        set: async (next) => { look = await bridge.setAppearance(next); paint(); return look; },
        restart: () => bridge.relaunch(),
      },
      tray: info.tray === null ? null : { closeToTray: () => closeToTray, setCloseToTray: async (on) => (closeToTray = await bridge.setCloseToTray(on)) },
      // An app older than this client has neither member.
      autostart: info.autostart && typeof bridge.setAutostart === "function" ? {
        enabled: () => autostart, set: async (on) => (autostart = await bridge.setAutostart(on)),
        background: typeof bridge.setAutostartBackground === "function" ? { get: () => autostartBackground, set: async (on) => (autostartBackground = await bridge.setAutostartBackground(on)) } : null,
      } : null,
      attention: typeof bridge.setAttention === "function" ? { set: (count) => bridge.setAttention(count) } : null,
      frame: {
        state: () => frame,
        subscribe: (cb) => { frameListeners.add(cb); cb(frame); return () => { frameListeners.delete(cb); }; },
        control: (action) => bridge.windowControl(action),
      },
    },
    updates: info.update.status === "unsupported" ? null : {
      get: () => update,
      subscribe: (cb) => { updateListeners.add(cb); cb(update); return () => { updateListeners.delete(cb); }; },
      check: () => bridge.checkForUpdates(),
      restartAndInstall: () => bridge.restartAndInstall(),
    },
  };
}

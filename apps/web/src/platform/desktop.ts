import type { DesktopBridge, UpdateState, WindowAppearance } from "./bridge";
import { parseDeepLink } from "./deepLink";
import type { Platform, ScreenPicker } from "./types";
import { popoutFeatures } from "./web";

/** The desktop app: no home server, the directory is fixed, and the shell (Electron main process) does what a browser would. */
export function desktopPlatform(bridge: DesktopBridge): Platform {
  const info = bridge.info;

  let picker: ScreenPicker | null = null;
  bridge.onScreenPickRequest((request) => {
    const answer = picker ? picker(request.sources, request.canShareAudio).catch(() => null) : Promise.resolve(null);
    void answer.then((pick) => bridge.answerScreenPick(request.requestId, pick));
  });

  let appearance: WindowAppearance = info.appearance;
  // The page follows the window: with a material the body is see-through and the surfaces take the chosen opacity (styles.css).
  const paint = () => {
    const root = document.documentElement;
    if (appearance.material === "none") { delete root.dataset.material; root.style.removeProperty("--win-alpha"); }
    else { root.dataset.material = appearance.material; root.style.setProperty("--win-alpha", String(appearance.opacity)); }
  };
  paint();

  let update: UpdateState = info.update;
  const updateListeners = new Set<(state: UpdateState) => void>();
  bridge.onUpdateState((state) => { update = state; for (const fn of updateListeners) fn(state); });

  return {
    kind: "desktop",
    os: info.os,
    app: { version: info.version, electron: info.electron, chrome: info.chrome },
    home: null,
    defaultDirectoryUrl: info.directoryUrl,
    // app:// is a secure scheme; only the development window (Vite over http) may load http resources.
    media: { blocksInsecureMedia: window.location.protocol !== "http:", screenSharePublishOverrides: () => null },
    links: {
      openExternal: (url) => bridge.openExternal(url),
      onDeepLink: (cb) => bridge.onDeepLink((raw) => { const link = parseDeepLink(raw); if (link) cb(link); }),
    },
    screen: { setPicker: (next) => { picker = next; } },
    window: {
      popoutFeatures,
      appearance: info.materials.length === 0 ? null : {
        materials: info.materials,
        get: () => appearance,
        set: async (next) => { appearance = await bridge.setAppearance(next); paint(); },
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

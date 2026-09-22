import { Menu, nativeImage, Tray, type BrowserWindow } from "electron";
import { join } from "node:path";
import type { ShellLanguage } from "./contextMenuItems";

/**
 * The app in the system tray (user's wish, 18 September 2026): an icon that shows or hides the window on a click and offers
 * "open" and "quit". Whether the window's close button quits the app or only hides it to the tray is the user's setting
 * (`closeToTray` in desktop-config.json, off by default: someone who closes the window while in a voice channel should not
 * stay on the air without having asked for it).
 */
const trayImage = (file: string) => nativeImage.createFromPath(join(__dirname, "..", "build", file)).resize({ width: process.platform === "win32" ? 16 : 22, quality: "best" });

/** Direct messages or mentions wait (attention.ts): the tray icon gets a dot and says so in its tool tip. With the window hidden in the tray it is the only place that can. */
export function setTrayAttention(tray: Tray | null, waiting: boolean, text: string): void {
  if (!tray || tray.isDestroyed()) return;
  try {
    const image = trayImage(waiting ? "tray-alert.png" : "tray.png");
    if (!image.isEmpty()) tray.setImage(image);
    tray.setToolTip(text);
  } catch { /* the tray is gone */ }
}

const LABELS: Record<ShellLanguage, { open: string; quit: string }> = { de: { open: "Squorli öffnen", quit: "Beenden" }, en: { open: "Open Squorli", quit: "Quit" } };

/** What the menu's entries do, kept per tray so that the menu can be built again in another language. */
const actions = new WeakMap<Tray, { show: () => void; quit: () => void }>();

const trayMenu = (language: ShellLanguage, show: () => void, quit: () => void) =>
  Menu.buildFromTemplate([{ label: LABELS[language].open, click: show }, { type: "separator" }, { label: LABELS[language].quit, click: quit }]);

/** The menu in the client's language (index.ts, `IPC.language`); the system's language until the client says its own. */
export function setTrayLanguage(tray: Tray | null, language: ShellLanguage): void {
  if (!tray || tray.isDestroyed()) return;
  const own = actions.get(tray);
  if (own) tray.setContextMenu(trayMenu(language, own.show, own.quit));
}

export function createTray(getWindow: () => BrowserWindow | null, quit: () => void, language: ShellLanguage): Tray | null {
  try {
    // build/tray.png: the brand's small icon mark (tools/desktop-icon.mjs); packaged inside the app archive.
    const image = nativeImage.createFromPath(join(__dirname, "..", "build", "tray.png"));
    if (image.isEmpty()) return null;
    const tray = new Tray(image.resize({ width: process.platform === "win32" ? 16 : 22, quality: "best" }));
    const show = () => { const win = getWindow(); if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); };
    tray.setToolTip("Squorli");
    actions.set(tray, { show, quit });
    tray.setContextMenu(trayMenu(language, show, quit));
    tray.on("click", () => { const win = getWindow(); if (win && win.isVisible() && !win.isMinimized() && win.isFocused()) win.hide(); else show(); });
    return tray;
  } catch { return null; }
}

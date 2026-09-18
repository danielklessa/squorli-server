import { app, Menu, nativeImage, Tray, type BrowserWindow } from "electron";
import { join } from "node:path";

/**
 * The app in the system tray (user's wish, 18 September 2026): an icon that shows or hides the window on a click and offers
 * "open" and "quit". Whether the window's close button quits the app or only hides it to the tray is the user's setting
 * (`closeToTray` in desktop-config.json, off by default: someone who closes the window while in a voice channel should not
 * stay on the air without having asked for it).
 */
const LABELS = { de: { open: "Squorli öffnen", quit: "Beenden" }, en: { open: "Open Squorli", quit: "Quit" } };

export function createTray(getWindow: () => BrowserWindow | null, quit: () => void): Tray | null {
  try {
    // build/tray.png: the brand's small icon mark (tools/desktop-icon.mjs); packaged inside the app archive.
    const image = nativeImage.createFromPath(join(__dirname, "..", "build", "tray.png"));
    if (image.isEmpty()) return null;
    const tray = new Tray(image.resize({ width: process.platform === "win32" ? 16 : 22, quality: "best" }));
    const labels = app.getLocale().toLowerCase().startsWith("de") ? LABELS.de : LABELS.en;
    const show = () => { const win = getWindow(); if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); };
    tray.setToolTip("Squorli");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: labels.open, click: show }, { type: "separator" }, { label: labels.quit, click: quit }]));
    tray.on("click", () => { const win = getWindow(); if (win && win.isVisible() && !win.isMinimized() && win.isFocused()) win.hide(); else show(); });
    return tray;
  } catch { return null; }
}

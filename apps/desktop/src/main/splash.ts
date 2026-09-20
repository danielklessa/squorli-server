import { app, BrowserWindow } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPLASH_SKIP_URL, splashHtml, splashScript, splashView, type SplashStep } from "./splashPage";

/**
 * The start window (splashPage.ts says what it is for): small, frameless, no preload and no access to anything; the shell
 * writes into it. It stays until the client says its first screen is there (index.ts), or an update takes over.
 */
export type Splash = { show(step: SplashStep): void; onSkip(cb: () => void): void; close(): void };

export function createSplash(rendererRoot: string): Splash {
  const german = app.getLocale().toLowerCase().startsWith("de");
  let icon: string | null = null;
  try { icon = readFileSync(join(rendererRoot, "brand", "squorli-icon.svg"), "utf8"); } catch { /* a start window without a picture */ }
  const win = new BrowserWindow({
    width: 360, height: 300, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, center: true, show: false,
    backgroundColor: "#0a0f1e", title: "Squorli", ...(app.isPackaged ? {} : { icon: join(__dirname, "..", "build", "icon.png") }),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  win.removeMenu();
  let loaded = false;
  let pending: SplashStep | null = null;
  let skip: (() => void) | null = null;
  const paint = (step: SplashStep) => { if (!win.isDestroyed()) void win.webContents.executeJavaScript(splashScript(splashView(step, german))).catch(() => {}); };
  win.webContents.once("did-finish-load", () => { loaded = true; if (pending) paint(pending); });
  win.once("ready-to-show", () => { if (!win.isDestroyed()) win.show(); });
  // This window never goes anywhere. Its only link, "install later", is known by its address.
  win.webContents.on("will-navigate", (event, url) => { event.preventDefault(); if (url === SPLASH_SKIP_URL) skip?.(); });
  void win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(splashHtml(icon), "utf8").toString("base64")}`).catch(() => {});
  return {
    show: (step) => { pending = step; if (loaded) paint(step); },
    onSkip: (cb) => { skip = cb; },
    close: () => { if (!win.isDestroyed()) win.destroy(); },
  };
}

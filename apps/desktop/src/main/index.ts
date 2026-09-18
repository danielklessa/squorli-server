import { app, BrowserWindow, ipcMain, screen, session, type IpcMainEvent, type IpcMainInvokeEvent, type Tray } from "electron";
import { release } from "node:os";
import { join } from "node:path";
import { INFO_ARGUMENT, IPC, type AppearanceState, type DesktopInfo, type PlatformOs, type UpdateState, type WindowAppearance, type WindowFrameState } from "@squorli/web/platform/bridge";
import { APP_ORIGIN } from "./appFiles";
import { appearanceState, normalizeAppearance, supportedMaterials } from "./appearance";
import { loadConfig, saveConfig } from "./config";
import { findDeepLink } from "./deepLinkArgs";
import { handleDeepLinks } from "./deepLinks";
import { handleDisplayMedia } from "./displayMedia";
import { registerAppScheme, serveApp } from "./scheme";
import { applyPermissions, letPlayersEmbed, lockDownContents, openExternal } from "./security";
import { createTray } from "./tray";
import { desktopUserAgent } from "./userAgent";
import { helperPath, ScreenAudioCapture } from "./windowAudio";
import { DEFAULT_SIZE, MIN_SIZE, restoreWindowState } from "./windowState";

/**
 * Squorli desktop: an Electron shell around the web client (docs/features/desktop.md). It has no renderer code of its own:
 * the window shows the build of `apps/web` from `app://squorli`, and everything the client needs from the shell goes through
 * the preload bridge (`@squorli/web/platform/bridge`).
 *
 * Development: `--dev-url=http://localhost:5173` shows the Vite server instead (with its own user data folder).
 */
const DIRECTORY_URL = "https://directory.squorli.com";

const argValue = (name: string): string | null => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
// Only an unpackaged app takes these: a packaged one always shows its own files and talks to the public directory.
const devUrl = app.isPackaged ? null : argValue("dev-url");
const directoryUrl = (app.isPackaged ? null : argValue("directory-url")) ?? DIRECTORY_URL;
const originOf = (url: string): string => { const u = new URL(url); return `${u.protocol}//${u.host}`; };
const origins = devUrl ? [APP_ORIGIN, originOf(devUrl)] : [APP_ORIGIN];

app.setName("Squorli");
// Windows groups task bar entries and notifications by this id; it equals the installer's appId. Unpackaged it also makes the
// task bar show the window's icon instead of Electron's.
if (process.platform === "win32") app.setAppUserModelId("com.squorli.desktop");
if (devUrl) app.setPath("userData", join(app.getPath("appData"), "Squorli-dev"));
app.userAgentFallback = desktopUserAgent(app.userAgentFallback, app.getVersion());
registerAppScheme();

const os: PlatformOs = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : "other";
// Window background (opaque, mica, or a see-through window, plus the opacity of the client's surfaces): per device, read
// before the window exists. Whether the window is see-through is fixed when it is created (appearance.ts).
const materials = supportedMaterials(process.platform, release());
let appearance: WindowAppearance = normalizeAppearance(loadConfig(app.getPath("userData")).appearance, materials);
const transparentWindow = appearance.material === "clear";
let look: AppearanceState = appearanceState(appearance, transparentWindow, transparentWindow ? "clear" : appearance.material);
const SOLID = "#0a0f1e";
/** Mica and opaque switch while the app runs; with mica the window's own colour must let the material through. */
function applyAppearance(win: BrowserWindow): void {
  if (transparentWindow || !materials.includes("mica")) return;
  win.setBackgroundMaterial(look.effective === "mica" ? "mica" : "none");
  win.setBackgroundColor(look.effective === "mica" ? "#00000000" : SOLID);
}
const frameOf = (win: BrowserWindow): WindowFrameState => ({ maximized: win.isMaximized(), focused: win.isFocused(), fullscreen: win.isFullScreen() });
const update: UpdateState = { status: "unsupported" };

let mainWindow: BrowserWindow | null = null;
// Tray icon; with `closeToTray` the window's close button only hides the window. Quitting then goes through the tray's menu.
let tray: Tray | null = null;
let closeToTray = loadConfig(app.getPath("userData")).closeToTray === true;
let quitting = false;

/** Messages count only when they come from the client's own main frame, never from an embedded player or a foreign page. */
const isClientFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  try { return origins.includes(originOf(frame.url)); } catch { return false; }
};

function createWindow(): BrowserWindow {
  const info: DesktopInfo = { version: app.getVersion(), electron: process.versions.electron ?? "", chrome: process.versions.chrome ?? "", os, directoryUrl, materials, nativeScreenAudio: helperPath() !== null, appearance: look, frame: { maximized: false, focused: true, fullscreen: false }, tray: tray ? { closeToTray } : null, update };
  // The window reopens where it was closed, as long as that place still lies on a display (windowState.ts).
  const userData = app.getPath("userData");
  const state = restoreWindowState(loadConfig(userData).window, screen.getAllDisplays().map((d) => d.workArea));
  info.frame.maximized = state?.maximized === true;
  const win = new BrowserWindow({
    // No system title bar: the client draws its own (TitleBar.tsx). A see-through window must be frameless anyway.
    frame: false, transparent: transparentWindow,
    ...(state ? state.bounds : DEFAULT_SIZE), minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height, show: false,
    // A packaged app carries its icon in the executable; unpackaged the window names it, or Electron's icon shows.
    ...(app.isPackaged ? {} : { icon: join(__dirname, "..", "build", "icon.png") }), backgroundColor: look.effective === "none" ? SOLID : "#00000000", ...(look.effective === "mica" ? { backgroundMaterial: "mica" as const } : {}), autoHideMenuBar: true, title: "Squorli",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true,
      // Voice keeps running while the window is minimized or covered.
      backgroundThrottling: false,
      additionalArguments: [`${INFO_ARGUMENT}${Buffer.from(JSON.stringify(info)).toString("base64")}`],
    },
  });
  win.removeMenu();
  if (state?.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  // The own title bar shows the window's state (maximize or restore, dimmed while inactive).
  const tellFrame = () => { if (!win.isDestroyed()) win.webContents.send(IPC.windowFrame, frameOf(win)); };
  win.on("maximize", tellFrame); win.on("unmaximize", tellFrame); win.on("focus", tellFrame); win.on("blur", tellFrame);
  win.on("enter-full-screen", tellFrame); win.on("leave-full-screen", tellFrame); win.on("restore", tellFrame);
  win.webContents.on("did-finish-load", tellFrame);
  // Remembered when it closes, and a moment after every move or resize (a crash or a shutdown skips "close").
  let rememberTimer: ReturnType<typeof setTimeout> | null = null;
  const remember = () => {
    if (rememberTimer) { clearTimeout(rememberTimer); rememberTimer = null; }
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    saveConfig(userData, { ...loadConfig(userData), window: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } });
  };
  const rememberSoon = () => { if (rememberTimer) clearTimeout(rememberTimer); rememberTimer = setTimeout(remember, 800); };
  win.on("resize", rememberSoon); win.on("move", rememberSoon); win.on("close", remember);
  win.on("close", (event) => { if (closeToTray && tray && !quitting) { event.preventDefault(); win.hide(); } });
  win.on("closed", () => { if (rememberTimer) clearTimeout(rememberTimer); if (mainWindow === win) mainWindow = null; });
  void win.loadURL(devUrl ?? `${APP_ORIGIN}/`);
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  const links = handleDeepLinks(() => mainWindow, isClientFrame);
  // A second start (the system opening a `squorli://` link while the app runs) hands its arguments over and quits.
  app.on("second-instance", (_event, argv) => {
    links.deliver(findDeepLink(argv));
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  lockDownContents(origins);
  void app.whenReady().then(() => {
    // Unpackaged: the build of the sibling package; packaged: electron-builder copies it next to the app (extraResources).
    serveApp(app.isPackaged ? join(process.resourcesPath, "renderer") : join(__dirname, "..", "..", "web", "dist"));
    applyPermissions(session.defaultSession, origins);
    if (app.isPackaged || !process.argv.includes("--no-player-fix")) letPlayersEmbed(session.defaultSession);
    const screenAudio = new ScreenAudioCapture();
    handleDisplayMedia(session.defaultSession, isClientFrame, screenAudio);
    ipcMain.on(IPC.screenAudioStop, (event) => { if (isClientFrame(event)) screenAudio.stop(); });
    app.on("before-quit", () => { quitting = true; screenAudio.stop(); });
    ipcMain.handle(IPC.setAppearance, (event, next: unknown) => {
      if (!isClientFrame(event)) return look;
      appearance = normalizeAppearance(next, materials);
      saveConfig(app.getPath("userData"), { ...loadConfig(app.getPath("userData")), appearance });
      look = appearanceState(appearance, transparentWindow, look.effective);
      if (mainWindow) applyAppearance(mainWindow);
      return look;
    });
    ipcMain.on(IPC.relaunch, (event) => { if (isClientFrame(event)) { app.relaunch(); app.quit(); } });
    ipcMain.on(IPC.windowControl, (event, action: unknown) => {
      const win = mainWindow;
      if (!isClientFrame(event) || !win) return;
      if (action === "minimize") win.minimize();
      else if (action === "toggle-maximize") { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
      else if (action === "close") win.close();
    });
    ipcMain.handle(IPC.setCloseToTray, (event, on: unknown) => {
      if (!isClientFrame(event)) return closeToTray;
      closeToTray = on === true;
      saveConfig(app.getPath("userData"), { ...loadConfig(app.getPath("userData")), closeToTray });
      return closeToTray;
    });
    ipcMain.on(IPC.openExternal, (event, url: unknown) => { if (isClientFrame(event) && typeof url === "string") openExternal(url); });
    tray = createTray(() => mainWindow, () => { quitting = true; app.quit(); });
    mainWindow = createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

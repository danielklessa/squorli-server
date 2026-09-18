import { app, BrowserWindow, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { release } from "node:os";
import { join } from "node:path";
import { INFO_ARGUMENT, IPC, type DesktopInfo, type PlatformOs, type UpdateState, type WindowAppearance } from "@squorli/web/platform/bridge";
import { APP_ORIGIN } from "./appFiles";
import { normalizeAppearance, supportedMaterials } from "./appearance";
import { loadConfig, saveConfig } from "./config";
import { findDeepLink } from "./deepLinkArgs";
import { handleDeepLinks } from "./deepLinks";
import { handleDisplayMedia } from "./displayMedia";
import { registerAppScheme, serveApp } from "./scheme";
import { applyPermissions, letPlayersEmbed, lockDownContents, openExternal } from "./security";
import { desktopUserAgent } from "./userAgent";

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
if (devUrl) app.setPath("userData", join(app.getPath("appData"), "Squorli-dev"));
app.userAgentFallback = desktopUserAgent(app.userAgentFallback, app.getVersion());
registerAppScheme();

const os: PlatformOs = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : "other";
// Window background (mica/acrylic + opacity of the client's surfaces): per device, read before the window exists.
const materials = supportedMaterials(process.platform, release());
let appearance: WindowAppearance = normalizeAppearance(loadConfig(app.getPath("userData")).appearance, materials);
/** With a material the window itself must be see-through; the client paints its surfaces with the chosen opacity. */
const SOLID = "#0a0f1e";
function applyAppearance(win: BrowserWindow): void {
  if (materials.length === 0) return;
  win.setBackgroundMaterial(appearance.material);
  win.setBackgroundColor(appearance.material === "none" ? SOLID : "#00000000");
}
const update: UpdateState = { status: "unsupported" };

let mainWindow: BrowserWindow | null = null;

/** Messages count only when they come from the client's own main frame, never from an embedded player or a foreign page. */
const isClientFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  try { return origins.includes(originOf(frame.url)); } catch { return false; }
};

function createWindow(): BrowserWindow {
  const info: DesktopInfo = { version: app.getVersion(), electron: process.versions.electron ?? "", chrome: process.versions.chrome ?? "", os, directoryUrl, materials, appearance, update };
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 480, show: false, backgroundColor: appearance.material === "none" ? SOLID : "#00000000", ...(appearance.material !== "none" ? { backgroundMaterial: appearance.material } : {}), autoHideMenuBar: true, title: "Squorli",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true,
      // Voice keeps running while the window is minimized or covered.
      backgroundThrottling: false,
      additionalArguments: [`${INFO_ARGUMENT}${Buffer.from(JSON.stringify(info)).toString("base64")}`],
    },
  });
  win.removeMenu();
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
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
    mainWindow.focus();
  });
  lockDownContents(origins);
  void app.whenReady().then(() => {
    // Unpackaged: the build of the sibling package; packaged: electron-builder copies it next to the app (extraResources).
    serveApp(app.isPackaged ? join(process.resourcesPath, "renderer") : join(__dirname, "..", "..", "web", "dist"));
    applyPermissions(session.defaultSession, origins);
    if (app.isPackaged || !process.argv.includes("--no-player-fix")) letPlayersEmbed(session.defaultSession);
    handleDisplayMedia(session.defaultSession, isClientFrame);
    ipcMain.handle(IPC.setAppearance, (event, next: unknown) => {
      if (!isClientFrame(event)) return appearance;
      appearance = normalizeAppearance(next, materials);
      saveConfig(app.getPath("userData"), { ...loadConfig(app.getPath("userData")), appearance });
      if (mainWindow) applyAppearance(mainWindow);
      return appearance;
    });
    ipcMain.on(IPC.openExternal, (event, url: unknown) => { if (isClientFrame(event) && typeof url === "string") openExternal(url); });
    mainWindow = createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

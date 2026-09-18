import { app, ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import { autoUpdater } from "electron-updater";
import { IPC, type UpdateState } from "@squorli/web/platform/bridge";
import { updateMode } from "./updateMode";

/**
 * App updates (docs/features/desktop.md, P4). The app asks only `https://squorli.com/updates/stable/` (the address is baked in
 * at packaging: `publish` in electron-builder.yml -> resources/app-update.yml); the manifests there point at the release files
 * on GitHub with absolute addresses, and every download is checked against the sha512 of the manifest. The builds are
 * unsigned, so that manifest, fetched over TLS from squorli.com, is what the trust rests on.
 *
 * Windows (NSIS) and the AppImage update themselves: download in the background, install when the user restarts from the
 * client's notice or quits. A deb installation cannot replace itself: it only learns that a version exists (`manual`) and
 * the client links to the download page. An unpackaged app has no updates.
 */
const CHECK_AFTER_START_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function handleUpdates(getWindow: () => BrowserWindow | null, isClientFrame: (event: IpcMainEvent) => boolean, beforeInstall: () => void): { state: () => UpdateState } {
  const mode = updateMode({ packaged: app.isPackaged, platform: process.platform, appImage: !!process.env.APPIMAGE });
  let state: UpdateState = mode === "none" ? { status: "unsupported" } : { status: "idle", checkedAt: null };
  if (mode === "none") return { state: () => state };

  const tell = (next: UpdateState) => { state = next; const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send(IPC.updateState, state); };
  autoUpdater.autoDownload = mode === "self";
  autoUpdater.autoInstallOnAppQuit = mode === "self";
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => tell({ status: "checking" }));
  autoUpdater.on("update-not-available", () => tell({ status: "idle", checkedAt: Date.now() }));
  autoUpdater.on("update-available", (info) => tell(mode === "manual" ? { status: "available", version: info.version, manual: true } : { status: "downloading", version: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (progress) => { if (state.status === "downloading") tell({ ...state, percent: Math.round(progress.percent) }); });
  autoUpdater.on("update-downloaded", (info) => tell({ status: "ready", version: info.version }));
  autoUpdater.on("error", (error) => tell({ status: "error", message: error.message.split("\n")[0]!.slice(0, 300) }));

  const check = () => { if (state.status !== "checking" && state.status !== "downloading" && state.status !== "ready") void autoUpdater.checkForUpdates().catch(() => { /* reported through the error event */ }); };
  setTimeout(check, CHECK_AFTER_START_MS);
  setInterval(check, CHECK_EVERY_MS);
  ipcMain.on(IPC.updateCheck, (event) => { if (isClientFrame(event)) check(); });
  ipcMain.on(IPC.updateInstall, (event) => {
    if (!isClientFrame(event) || state.status !== "ready") return;
    beforeInstall();
    autoUpdater.quitAndInstall(false, true);
  });
  return { state: () => state };
}

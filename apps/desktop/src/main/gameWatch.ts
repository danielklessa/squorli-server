import { app, dialog, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { IPC, type CustomProgram, type DetectedGame, type GameWatchSettings, type RunningGame } from "@squorli/web/platform/bridge";
import type { InstalledGame } from "./games/launchers";
import { GameIcons } from "./games/icons";
import { detectedGames, fileTitle, gameOfPath, iconSources, readGameWatch, watchLine } from "./games/match";
import { scanInstalledGames } from "./games/scan";
import type { SystemWatch } from "./systemWatch";

/**
 * Game detection (docs/features/games.md; stage 2: everything stays on this computer). The client says whether detection is
 * on and which programs the user added; this reads the launchers' installed games (games/scan.ts), hands the system watch
 * helper their folders and tells the client which game is in front. While detection is off the helper watches nothing, and
 * it never reports a program outside the list.
 */
const RESCAN_MS = 60 * 60_000;

export function handleGames(getWindow: () => BrowserWindow | null, isClientFrame: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean, watch: SystemWatch): void {
  let settings: GameWatchSettings = { enabled: false, custom: [] };
  let installed: InstalledGame[] = [];
  let scanned = false;
  let running: RunningGame | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const icons = new GameIcons();

  const tell = () => { const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send(IPC.gameRunning, running); };
  const apply = () => watch.setWatch(watchLine(installed, settings));
  const scan = async (): Promise<DetectedGame[]> => {
    installed = await scanInstalledGames();
    scanned = true;
    apply();
    return detectedGames(installed, settings.custom);
  };

  watch.onGame((path) => {
    const next = path ? gameOfPath(path, installed, settings.custom) : null;
    if (next?.id === running?.id && next?.name === running?.name) return;
    running = next;
    tell();
  });
  ipcMain.on(IPC.gameRunningReady, (event) => { if (isClientFrame(event)) tell(); });
  // While detection is off the launchers' files are not even read. The list for the settings gets each game's icon from this
  // computer (games/icons.ts); the hourly scan needs none.
  ipcMain.handle(IPC.gamesScan, async (event): Promise<DetectedGame[]> => {
    if (!isClientFrame(event) || !settings.enabled) return [];
    const games = await scan();
    const found = await icons.of(iconSources(installed, settings.custom));
    return games.map((game) => ({ ...game, icon: found.get(game.id) ?? null }));
  });
  ipcMain.on(IPC.gamesWatch, (event, value: unknown) => {
    if (!isClientFrame(event)) return;
    settings = readGameWatch(value);
    if (timer) { clearInterval(timer); timer = null; }
    // New installations show up within the hour, or at once when the settings ask for the list.
    if (settings.enabled) timer = setInterval(() => { void scan(); }, RESCAN_MS);
    if (settings.enabled && !scanned) void scan(); else apply();
  });
  ipcMain.handle(IPC.gamesPick, async (event): Promise<CustomProgram | null> => {
    const win = getWindow();
    if (!isClientFrame(event) || !win) return null;
    const german = app.getLocale().toLowerCase().startsWith("de");
    const picked = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: german ? "Programme" : "Programs", extensions: ["exe"] }] });
    const path = picked.canceled ? undefined : picked.filePaths[0];
    return path ? { path, name: fileTitle(path) } : null;
  });
}

import { ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { IPC, type SystemActivityEvent } from "@squorli/web/platform/bridge";
import { SystemWatchLines } from "./systemWatchLines";
import { nativeHelperPath } from "./windowAudio";

/**
 * What the client's AFK detection cannot see from inside the window (docs/features/afk.md, 20 September 2026): the native
 * helper `squorli-system-watch.exe` (apps/desktop/native, Windows) reports controller input, which Chromium's Gamepad API only
 * delivers while the window has the focus, and whether some program keeps the display on (a playing video). It runs as long
 * as the app does. Optional like the audio helper: without it (not built, other platform) nothing is reported.
 */
export const systemWatchPath = (): string | null => nativeHelperPath("squorli-system-watch.exe");

const RESTART_MS = 5000;
const MAX_RESTARTS = 5;

export type SystemWatch = {
  /** The helper's watch list (its stdin line, games/match.ts); kept and sent again when the helper had to be restarted. */
  setWatch(line: string): void;
  /** A watched program came to the front (its path), or null = it has ended. */
  onGame(cb: (path: string | null) => void): void;
  stop(): void;
};

export function startSystemWatch(getWindow: () => BrowserWindow | null, isClientFrame: (event: IpcMainEvent) => boolean): SystemWatch {
  let child: ChildProcess | null = null;
  let watch = "watch";
  let gameListener: (path: string | null) => void = () => {};
  let stopped = false;
  let restarts = 0;
  let display: boolean | null = null;
  const send = (event: SystemActivityEvent) => { const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send(IPC.systemActivity, event); };
  // A client that starts listening (a reload too) learns the display state as it is; input only counts from now on.
  ipcMain.on(IPC.systemActivityReady, (event) => { if (isClientFrame(event) && display !== null) send({ type: "display", required: display }); });

  const run = () => {
    const helper = systemWatchPath();
    if (!helper || stopped) return;
    const lines = new SystemWatchLines();
    const decoder = new StringDecoder("utf8");
    const started = spawn(helper, [], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    child = started;
    started.stdin?.on("error", () => {});
    started.stdin?.write(`${watch}\n`);
    started.stdout?.on("data", (data: Buffer) => {
      for (const event of lines.push(decoder.write(data))) {
        if (event.type === "game") { gameListener(event.path); continue; }
        if (event.type === "display") display = event.required;
        send(event);
      }
    });
    started.on("error", () => {});
    started.on("exit", () => {
      if (child === started) { child = null; gameListener(null); }
      if (stopped || restarts >= MAX_RESTARTS) return;
      restarts++;
      setTimeout(run, RESTART_MS);
    });
  };
  run();

  return {
    setWatch: (line) => { watch = line; child?.stdin?.write(`${line}\n`); },
    onGame: (cb) => { gameListener = cb; },
    stop: () => {
      stopped = true;
      const running = child;
      child = null;
      if (!running) return;
      // Closing stdin is the helper's signal to end; the kill is the safety net.
      running.stdin?.end();
      setTimeout(() => { if (running.exitCode === null) running.kill(); }, 500);
    },
  };
}

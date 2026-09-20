import { app } from "electron";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AUTOSTART_ARG, entryStarts, linuxAutostartEntry, linuxAutostartFile, linuxExecutable } from "./autostart";

/**
 * Start with the system, the part that touches it (autostart.ts says how). Only a packaged app offers it: unpackaged the
 * executable is Electron's own. `--autostart-test` (unpackaged only) registers the development app under a name of its
 * own, to try the setting without an installer.
 */
const test = !app.isPackaged && process.argv.includes("--autostart-test");
// The value's name under the user's `Run` key is ours to choose; Electron's `openAtLogin` only knows its own default name
// (measured: false although the value was there), so the entry is looked up by this name in `launchItems`.
const windowsItem = () => test
  ? { name: "Squorli-autostart-test", path: process.execPath, args: [app.getAppPath(), AUTOSTART_ARG] }
  : { name: "Squorli", path: process.execPath, args: [AUTOSTART_ARG] };

export function autostartSupported(): boolean {
  if (!app.isPackaged && !test) return false;
  return process.platform === "win32" || (process.platform === "linux" && linuxAutostartFile(process.env) !== null);
}

export function autostartEnabled(): boolean {
  if (!autostartSupported()) return false;
  if (process.platform === "win32") {
    const item = windowsItem();
    // `enabled` = not switched off in the system's own list of startup apps (Task Manager, Settings).
    return app.getLoginItemSettings({ path: item.path, args: item.args }).launchItems.some((i) => i.name === item.name && i.enabled);
  }
  try {
    const file = linuxAutostartFile(process.env)!;
    const executable = linuxExecutable(process.env, process.execPath);
    const entry = readFileSync(file, "utf8");
    // Still on, but for a file that is somewhere else by now (an AppImage that was moved or updated): follow it.
    if (!entryStarts(entry, executable)) writeFileSync(file, linuxAutostartEntry(executable));
    return true;
  } catch { return false; }
}

/** Answers with what is set afterwards. */
export function setAutostart(on: boolean): boolean {
  if (!autostartSupported()) return false;
  try {
    if (process.platform === "win32") app.setLoginItemSettings({ ...windowsItem(), openAtLogin: on, enabled: on });
    else {
      const file = linuxAutostartFile(process.env)!;
      if (on) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, linuxAutostartEntry(linuxExecutable(process.env, process.execPath))); }
      else rmSync(file, { force: true });
    }
  } catch { /* the answer below says what is true */ }
  return autostartEnabled();
}

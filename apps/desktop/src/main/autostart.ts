import { join } from "node:path";

/**
 * Starting with the system (user's wish, 20 September 2026; the setting is off by default). Pure part, tested; what talks to
 * the system is autostartSystem.ts. The system starts the app with `--autostart`. Whether such a start opens the window or
 * stays in the background is the user's choice (their decision, 20 September 2026: "der Benutzer soll entscheiden können,
 * ob er es minimiert/versteckt oder geöffnet starten möchte"; `autostartBackground` in desktop-config.json, on by default).
 * In the background means: hidden in the tray when the window's close button keeps the app running there (`closeToTray`),
 * minimized in the task bar otherwise (closing quits there, so a hidden window would be out of reach). Windows: a value under the user's `Run` key (Electron's login item). Linux: a desktop entry in the user's
 * autostart folder (freedesktop.org "Desktop Application Autostart"), which Electron does not write itself.
 */
export const AUTOSTART_ARG = "--autostart";

export const startedBySystem = (argv: readonly string[]): boolean => argv.includes(AUTOSTART_ARG);

/** The stored choice; anything but an explicit "no" means in the background. */
export const readAutostartBackground = (stored: unknown): boolean => stored !== false;

/** Does this start keep the window away from the user? Only a start by the system, and only if the user wants that. */
export const startsInBackground = (argv: readonly string[], stored: unknown): boolean => startedBySystem(argv) && readAutostartBackground(stored);

export function linuxAutostartFile(env: { XDG_CONFIG_HOME?: string | undefined; HOME?: string | undefined }): string | null {
  const base = env.XDG_CONFIG_HOME || (env.HOME ? join(env.HOME, ".config") : "");
  return base ? join(base, "autostart", "squorli.desktop") : null;
}

/** An AppImage runs from a mount that is gone after the app closes: the file the user started is named by `APPIMAGE`. */
export const linuxExecutable = (env: { APPIMAGE?: string | undefined }, execPath: string): string => env.APPIMAGE || execPath;

/** Quoting of the desktop entry specification: double quotes, with `"`, `` ` ``, `$` and `\` escaped; a literal `%` is doubled. */
const quoteExec = (path: string): string => `"${path.replace(/(["`$\\])/g, "\\$1").replace(/%/g, "%%")}"`;

export function linuxAutostartEntry(executable: string): string {
  return ["[Desktop Entry]", "Type=Application", "Name=Squorli", `Exec=${quoteExec(executable)} ${AUTOSTART_ARG}`, "Icon=squorli", "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

/** Does the entry on disk start this executable? (An AppImage that was moved or replaced by a newer file: written again at the next start.) */
export const entryStarts = (entry: string, executable: string): boolean => entry.includes(`Exec=${quoteExec(executable)} ${AUTOSTART_ARG}`);

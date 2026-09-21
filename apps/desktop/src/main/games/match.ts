import type { CustomProgram, DetectedGame, GameWatchSettings, RunningGame } from "@squorli/web/platform/bridge";
import type { InstalledGame } from "./launchers";

/**
 * Between the launchers' lists, the system watch helper and the client (pure, tested): the helper's watch list, which game
 * a reported executable belongs to, and what the client may send. Paths never leave the main process, except those of
 * programs the user added, which came from the client in the first place.
 */
const MAX_CUSTOM = 100;
const MAX_PATH_CHARS = 1024;
const MAX_NAME_CHARS = 64;

export const customId = (path: string): string => `custom:${path.toLowerCase()}`;

/** What the client sent as its settings, made safe: a switch and a list of executables with names. */
export function readGameWatch(value: unknown): GameWatchSettings {
  const settings = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const custom: CustomProgram[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(settings.custom) ? settings.custom : []) {
    if (custom.length >= MAX_CUSTOM || !entry || typeof entry !== "object") continue;
    const { path, name } = entry as Record<string, unknown>;
    if (typeof path !== "string" || typeof name !== "string") continue;
    const clean = path.replace(/\//g, "\\").trim();
    // A full path of one executable: a drive, no tabs or line breaks (they would break the helper's line), nothing relative.
    if (clean.length > MAX_PATH_CHARS || !/^[a-z]:\\[^\t\r\n]+\.exe$/i.test(clean) || clean.includes("\\..\\") || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    custom.push({ path: clean, name: name.trim().slice(0, MAX_NAME_CHARS) || fileTitle(clean) });
  }
  return { enabled: settings.enabled === true, custom };
}

/** "C:\Games\Foo\foo.exe" -> "foo": the name a program gets until the user gives it one. */
export const fileTitle = (path: string): string => path.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");

/** The helper's stdin line: folders of the installed games, executables the user added; nothing while the feature is off. */
export function watchLine(installed: readonly InstalledGame[], settings: GameWatchSettings): string {
  if (!settings.enabled) return "watch";
  const paths = [...installed.map((g) => g.dir), ...settings.custom.map((c) => c.path)].filter((p) => !/[\t\r\n]/.test(p));
  return ["watch", ...new Set(paths)].join("\t");
}

/** The game an executable belongs to: a program the user added, else the installation whose folder holds it (the deepest one). */
export function gameOfPath(path: string, installed: readonly InstalledGame[], custom: readonly CustomProgram[]): RunningGame | null {
  const lower = path.toLowerCase();
  const own = custom.find((c) => c.path.toLowerCase() === lower);
  if (own) return { id: customId(own.path), name: own.name };
  let best: InstalledGame | null = null;
  for (const game of installed) if (lower.startsWith(game.dir.toLowerCase()) && (!best || game.dir.length > best.dir.length)) best = game;
  return best ? { id: best.id, name: best.name } : null;
}

/** Where the icon of each entry of that list may come from (games/icons.ts): the launcher's sources, an added program's own executable. */
export function iconSources(installed: readonly InstalledGame[], custom: readonly CustomProgram[]): Map<string, readonly string[]> {
  const byId = new Map<string, readonly string[]>();
  for (const game of installed) if (!byId.has(game.id)) byId.set(game.id, game.icons);
  for (const program of custom) byId.set(customId(program.path), [program.path]);
  return byId;
}

/** The list for the settings: installed games and added programs by name, one entry per id. */
export function detectedGames(installed: readonly InstalledGame[], custom: readonly CustomProgram[]): DetectedGame[] {
  const byId = new Map<string, DetectedGame>();
  for (const game of installed) if (!byId.has(game.id)) byId.set(game.id, { id: game.id, name: game.name, source: game.source });
  for (const program of custom) byId.set(customId(program.path), { id: customId(program.path), name: program.name, source: "custom" });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

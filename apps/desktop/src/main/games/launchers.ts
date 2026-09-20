import type { GameSource } from "@squorli/web/platform/bridge";

/**
 * What the game launchers on this computer say is installed (game display, stage 2: local detection; the plan is named in
 * docs/features/games.md). Pure parsers of their files, tested; `scan.ts` reads the files. The id is the launcher's own
 * (`steam:730`), never an executable's name: names like game.exe collide, and the directory can resolve an id by itself later.
 */
export type InstalledGame = { id: string; name: string; source: GameSource; /** Folder of the installation, with a trailing backslash. */ dir: string };

/** A Windows folder path with backslashes and exactly one at the end. */
export const folderPath = (path: string): string => `${path.replace(/\//g, "\\").replace(/\\+$/, "")}\\`;

// --- Valve's text format (libraryfolders.vdf, appmanifest_*.acf): nested "key" "value" / "key" { ... }
export type Vdf = { [key: string]: string | Vdf };

export function parseVdf(text: string): Vdf {
  const tokens: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) tokens.push(match[2] ?? `"${(match[1] ?? "").replace(/\\(.)/g, (_all, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c))}`);
  let at = 0;
  const readObject = (): Vdf => {
    const result: Vdf = {};
    while (at < tokens.length) {
      const key = tokens[at++]!;
      if (key === "}") break;
      if (key === "{") continue; // malformed: a brace where a key belongs
      const value = tokens[at++];
      if (value === undefined) break;
      if (value === "{") result[key.slice(1)] = readObject();
      else if (value !== "}") result[key.slice(1)] = value.slice(1);
    }
    return result;
  };
  return readObject();
}

/** The library folders of a Steam installation (`steamapps/libraryfolders.vdf`). */
export function steamLibraries(vdf: Vdf): string[] {
  const root = vdf.libraryfolders;
  if (!root || typeof root === "string") return [];
  return Object.values(root).flatMap((entry) => (typeof entry !== "string" && typeof entry.path === "string" && entry.path ? [entry.path] : []));
}

// Installed through Steam but nothing anybody plays: the redistributables every library has.
const STEAM_NOT_GAMES = new Set(["228980"]);

/** One `appmanifest_<id>.acf` of the library at `library`. */
export function steamGame(vdf: Vdf, library: string): InstalledGame | null {
  const state = vdf.AppState;
  if (!state || typeof state === "string") return null;
  const { appid, name, installdir } = state;
  if (typeof appid !== "string" || !/^\d+$/.test(appid) || typeof name !== "string" || !name || typeof installdir !== "string" || !installdir || STEAM_NOT_GAMES.has(appid)) return null;
  return { id: `steam:${appid}`, name, source: "steam", dir: folderPath(`${library}\\steamapps\\common\\${installdir}`) };
}

/** One `.item` manifest of the Epic Games Launcher (JSON). Only whole games: no engine, no plugin, no add-on of another game. */
export function epicGame(json: unknown): InstalledGame | null {
  if (!json || typeof json !== "object") return null;
  const item = json as Record<string, unknown>;
  const { AppName, DisplayName, InstallLocation, MainGameAppName, AppCategories } = item;
  if (typeof AppName !== "string" || !AppName || typeof DisplayName !== "string" || !DisplayName || typeof InstallLocation !== "string" || !InstallLocation) return null;
  if (item.bIsApplication !== true || item.bIsIncompleteInstall === true) return null;
  if (!Array.isArray(AppCategories) || !AppCategories.includes("games")) return null;
  if (typeof MainGameAppName === "string" && MainGameAppName && MainGameAppName !== AppName) return null;
  return { id: `epic:${AppName}`, name: DisplayName, source: "epic", dir: folderPath(InstallLocation) };
}

/**
 * The output of `reg query <key> /s` (or of one key): per key its values. Lines look like "    name    REG_SZ    value";
 * names and values may contain spaces, the type never does.
 */
export function parseRegQuery(output: string): Map<string, Record<string, string>> {
  const keys = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { current = {}; keys.set(line.trim(), current); continue; }
    const match = /^\s{4}(.+?)\s{4}REG_[A-Z_]+\s{4}(.*)$/.exec(line);
    if (match && current) current[match[1]!] = match[2]!;
  }
  return keys;
}

/** GOG's registry entries (`HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>`); an entry that depends on another is an add-on. */
export function gogGames(keys: Map<string, Record<string, string>>): InstalledGame[] {
  const games: InstalledGame[] = [];
  for (const values of keys.values()) {
    const { gameID, gameName, path, dependsOn } = values;
    if (!gameID || !/^\d+$/.test(gameID) || !gameName || !path || dependsOn) continue;
    games.push({ id: `gog:${gameID}`, name: gameName, source: "gog", dir: folderPath(path) });
  }
  return games;
}

/** The folder of a drive's Xbox games, from its `.GamingRoot` file: "RGBX", a count, then the folder's name as UTF-16. */
export function xboxRootFolder(file: Uint8Array): string | null {
  if (file.length < 10 || String.fromCharCode(file[0]!, file[1]!, file[2]!, file[3]!) !== "RGBX") return null;
  let name = "";
  for (let at = 8; at + 1 < file.length; at += 2) {
    const code = file[at]! | (file[at + 1]! << 8);
    if (code === 0) break;
    name += String.fromCharCode(code);
  }
  name = name.replace(/^[\\/]+|[\\/]+$/g, "");
  return name && !name.includes("..") ? name : null;
}

/**
 * One `Content\MicrosoftGame.config` of an Xbox game folder (XML). Add-on packs have the same file but nothing to start;
 * a name that is a resource reference ("ms-resource:...") is replaced by the folder's name.
 */
export function xboxGame(config: string, folderName: string, contentDir: string): InstalledGame | null {
  if (!/<Executable\s[^>]*Name="[^"]+\.exe"/i.test(config)) return null;
  const storeId = /<StoreId>\s*([A-Za-z0-9]{6,20})\s*<\/StoreId>/.exec(config)?.[1];
  if (!storeId) return null;
  const shown = /<ShellVisuals\s[^>]*DefaultDisplayName="([^"]+)"/.exec(config)?.[1] ?? "";
  const name = decodeXml(shown && !/^ms-resource:/i.test(shown) ? shown : folderName).trim();
  return name ? { id: `xbox:${storeId.toUpperCase()}`, name, source: "xbox", dir: folderPath(contentDir) } : null;
}

const decodeXml = (text: string): string => text.replace(/&(amp|lt|gt|quot|apos);/g, (_all, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" })[name] ?? "");

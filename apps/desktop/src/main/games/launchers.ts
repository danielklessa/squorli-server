import type { GameSource } from "@squorli/web/platform/bridge";

/**
 * What the game launchers on this computer say is installed (game display, stage 2: local detection; the plan is named in
 * docs/features/games.md). Pure parsers of their files, tested; `scan.ts` reads the files. The id is the launcher's own
 * (`steam:730`), never an executable's name: names like game.exe collide, and the directory can resolve an id by itself later.
 */
export type InstalledGame = {
  id: string; name: string; source: GameSource;
  /** Folder of the installation, with a trailing backslash. */
  dir: string;
  /**
   * Where this computer has an icon of the game, best first (games/icons.ts reads the first that gives one): a picture, an
   * executable whose icon Windows knows, or Steam's cache folder of the app. For the list in the settings only; like `dir`
   * these paths stay in the main process.
   */
  icons: string[];
};

/** A Windows folder path with backslashes and exactly one at the end. */
export const folderPath = (path: string): string => `${path.replace(/\//g, "\\").replace(/\\+$/, "")}\\`;

/** A file a manifest names relative to its installation, as a full path; null for anything that would leave the folder. */
export function fileInside(dir: string, relative: unknown): string | null {
  if (typeof relative !== "string") return null;
  const clean = relative.replace(/\//g, "\\").replace(/^\\+/, "").trim();
  if (!clean || clean.length > 400 || /^[a-z]:/i.test(clean) || clean.split("\\").includes("..") || /[\t\r\n]/.test(clean)) return null;
  return `${folderPath(dir)}${clean}`;
}

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

/**
 * Steam keeps the pictures of every app of the library in `<Steam>\appcache\librarycache`: since 2024 a folder per app, in
 * which the small icon is the one picture named by its hash; before that `<appid>_icon.jpg` next to the others.
 */
export const steamIconFile = (names: readonly string[]): string | null => names.find((name) => /^[0-9a-f]{40}\.(jpg|png)$/i.test(name)) ?? null;

/** One `appmanifest_<id>.acf` of the library at `library`; `steamRoot` = the Steam installation, whose cache has the icons. */
export function steamGame(vdf: Vdf, library: string, steamRoot?: string): InstalledGame | null {
  const state = vdf.AppState;
  if (!state || typeof state === "string") return null;
  const { appid, name, installdir } = state;
  if (typeof appid !== "string" || !/^\d+$/.test(appid) || typeof name !== "string" || !name || typeof installdir !== "string" || !installdir || STEAM_NOT_GAMES.has(appid)) return null;
  const cache = steamRoot ? `${folderPath(steamRoot)}appcache\\librarycache\\` : null;
  return { id: `steam:${appid}`, name, source: "steam", dir: folderPath(`${library}\\steamapps\\common\\${installdir}`), icons: cache ? [`${cache}${appid}\\`, `${cache}${appid}_icon.jpg`] : [] };
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
  const exe = fileInside(InstallLocation, item.LaunchExecutable);
  return { id: `epic:${AppName}`, name: DisplayName, source: "epic", dir: folderPath(InstallLocation), icons: exe && /\.exe$/i.test(exe) ? [exe] : [] };
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
    // GOG puts an icon next to every game; the executable's own is the second choice.
    const exe = values.exe && /^[a-z]:\\[^\t\r\n]+\.exe$/i.test(values.exe) && !values.exe.includes("\\..\\") ? [values.exe] : [];
    games.push({ id: `gog:${gameID}`, name: gameName, source: "gog", dir: folderPath(path), icons: [`${folderPath(path)}goggame-${gameID}.ico`, ...exe] });
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
  // The store's small logo lies in the folder as a picture; the executable's icon is the second choice.
  const visuals = /<ShellVisuals\s[^>]*>/.exec(config)?.[0] ?? "";
  const logos = ["Square44x44Logo", "Square150x150Logo", "StoreLogo"].map((key) => fileInside(contentDir, new RegExp(`\\s${key}="([^"]+\\.png)"`, "i").exec(visuals)?.[1]));
  const exe = fileInside(contentDir, /<Executable\s[^>]*Name="([^"]+\.exe)"/i.exec(config)?.[1]);
  return name ? { id: `xbox:${storeId.toUpperCase()}`, name, source: "xbox", dir: folderPath(contentDir), icons: [...logos, exe].filter((file): file is string => file !== null) } : null;
}

const decodeXml = (text: string): string => text.replace(/&(amp|lt|gt|quot|apos);/g, (_all, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" })[name] ?? "");

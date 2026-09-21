import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { epicGame, gogGames, parseRegQuery, parseVdf, steamGame, steamLibraries, xboxGame, xboxRootFolder, type InstalledGame } from "./launchers";

/**
 * Reads what the launchers installed (Windows): Steam's library folders and app manifests, the Epic Games Launcher's
 * manifests, GOG's registry entries, the Xbox app's game folders. Every source is optional and every failure means "none
 * from there": a missing launcher, an unreadable file. Nothing is written and nothing leaves the computer.
 */
const EPIC_MANIFESTS = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
const SOURCE_TIMEOUT_MS = 8000;

const regQuery = (args: string[]): Promise<string> => new Promise((resolve) => {
  execFile("reg.exe", ["query", ...args], { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : stdout));
});
const readText = (file: string): Promise<string | null> => readFile(file, "utf8").then((text) => text, () => null);
const list = (dir: string): Promise<string[]> => readdir(dir).then((names) => names, () => []);

async function steam(): Promise<InstalledGame[]> {
  const values = [...parseRegQuery(await regQuery(["HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"])).values()][0];
  const root = values?.SteamPath?.replace(/\//g, "\\");
  if (!root) return [];
  const folders = await readText(join(root, "steamapps", "libraryfolders.vdf"));
  // The registry spells the path in lower case, the library list as the folders are: one entry per folder, the list's spelling first.
  const libraries = [...new Map([...(folders ? steamLibraries(parseVdf(folders)) : []), root].map((p) => p.replace(/\\+$/, "")).reverse().map((p) => [p.toLowerCase(), p])).values()];
  const games = await Promise.all(libraries.map(async (library) => {
    const manifests = (await list(join(library, "steamapps"))).filter((name) => /^appmanifest_\d+\.acf$/i.test(name));
    return Promise.all(manifests.map(async (name) => { const text = await readText(join(library, "steamapps", name)); return text ? steamGame(parseVdf(text), library, root) : null; }));
  }));
  return games.flat().filter((g): g is InstalledGame => g !== null);
}

async function epic(): Promise<InstalledGame[]> {
  const items = (await list(EPIC_MANIFESTS)).filter((name) => name.toLowerCase().endsWith(".item"));
  const games = await Promise.all(items.map(async (name) => {
    const text = await readText(join(EPIC_MANIFESTS, name));
    try { return text ? epicGame(JSON.parse(text)) : null; } catch { return null; }
  }));
  return games.filter((g): g is InstalledGame => g !== null);
}

const gog = async (): Promise<InstalledGame[]> => gogGames(parseRegQuery(await regQuery(["HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games", "/s"])));

async function xbox(): Promise<InstalledGame[]> {
  const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `${letter}:\\`);
  const games = await Promise.all(drives.map(async (drive) => {
    const marker = await readFile(join(drive, ".GamingRoot")).then((data) => data, () => null);
    const folder = marker ? xboxRootFolder(marker) : null;
    if (!folder) return [];
    const root = join(drive, folder);
    return Promise.all((await list(root)).map(async (name) => {
      const content = join(root, name, "Content");
      const config = await readText(join(content, "MicrosoftGame.config"));
      return config ? xboxGame(config, name, content) : null;
    }));
  }));
  return games.flat().filter((g): g is InstalledGame => g !== null);
}

/** A source that hangs (a network drive that does not answer) must not hold the others back. */
const limited = (source: Promise<InstalledGame[]>): Promise<InstalledGame[]> => Promise.race([source.catch(() => []), new Promise<InstalledGame[]>((resolve) => setTimeout(() => resolve([]), SOURCE_TIMEOUT_MS))]);

export async function scanInstalledGames(): Promise<InstalledGame[]> {
  if (process.platform !== "win32") return [];
  return (await Promise.all([steam(), epic(), gog(), xbox()].map(limited))).flat();
}

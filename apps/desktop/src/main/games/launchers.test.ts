import { describe, expect, it } from "vitest";
import { epicGame, folderPath, gogGames, parseRegQuery, parseVdf, steamGame, steamLibraries, xboxGame, xboxRootFolder } from "./launchers";

const LIBRARIES = `"libraryfolders"
{
	"0"
	{
		"path"		"G:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"apps"
		{
			"240"		"4890129565"
		}
	}
	"1"
	{
		"path"		"H:\\\\SteamLibrary"
		"apps"
		{
		}
	}
}`;

const MANIFEST = `"AppState"
{
	"appid"		"1133870"
	"universe"		"1"
	"LauncherPath"		"G:\\\\Program Files (x86)\\\\Steam\\\\steam.exe"
	"name"		"Space Engineers 2"
	"StateFlags"		"4"
	"installdir"		"SpaceEngineers2"
	"UserConfig"
	{
		"language"		"german"
	}
}`;

describe("Steam", () => {
  it("reads the library folders", () => {
    expect(steamLibraries(parseVdf(LIBRARIES))).toEqual(["G:\\Program Files (x86)\\Steam", "H:\\SteamLibrary"]);
  });

  it("reads an app manifest into id, name and installation folder", () => {
    expect(steamGame(parseVdf(MANIFEST), "H:\\SteamLibrary")).toEqual({ id: "steam:1133870", name: "Space Engineers 2", source: "steam", dir: "H:\\SteamLibrary\\steamapps\\common\\SpaceEngineers2\\" });
  });

  it("keeps quotes and nested blocks of the format apart", () => {
    const vdf = parseVdf(`"AppState" { "appid" "7" "name" "The \\"Best\\" Game" "installdir" "best" "Nested" { "name" "not this" } }`);
    expect(steamGame(vdf, "C:\\S")?.name).toBe("The \"Best\" Game");
  });

  it("skips the redistributables and anything incomplete", () => {
    expect(steamGame(parseVdf(`"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" }`), "C:\\S")).toBeNull();
    expect(steamGame(parseVdf(`"AppState" { "appid" "10" "name" "No folder" }`), "C:\\S")).toBeNull();
    expect(steamGame(parseVdf("not a manifest"), "C:\\S")).toBeNull();
    expect(steamLibraries(parseVdf("{ broken"))).toEqual([]);
  });
});

describe("Epic", () => {
  const game = { AppName: "Sugar", DisplayName: "Rocket League®", InstallLocation: "F:/Epic Games/rocketleague", MainGameAppName: "Sugar", bIsApplication: true, bIsIncompleteInstall: false, AppCategories: ["public", "games", "applications"] };

  it("takes a whole installed game", () => {
    expect(epicGame(game)).toEqual({ id: "epic:Sugar", name: "Rocket League®", source: "epic", dir: "F:\\Epic Games\\rocketleague\\" });
  });

  it("leaves out plugins, engines, add-ons and unfinished installations", () => {
    expect(epicGame({ ...game, bIsApplication: false, AppCategories: ["plugins/engine", "plugins"] })).toBeNull();
    expect(epicGame({ ...game, AppCategories: ["public", "engines"] })).toBeNull();
    expect(epicGame({ ...game, MainGameAppName: "OtherGame" })).toBeNull();
    expect(epicGame({ ...game, bIsIncompleteInstall: true })).toBeNull();
    expect(epicGame(null)).toBeNull();
    expect(epicGame("text")).toBeNull();
  });
});

describe("GOG", () => {
  it("reads the registry listing and leaves add-ons out", () => {
    const output = [
      "", "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924",
      "    gameID    REG_SZ    1207658924", "    gameName    REG_SZ    The Witcher 3: Wild Hunt", "    path    REG_SZ    D:\\GOG Games\\The Witcher 3", "    dependsOn    REG_SZ    ",
      "", "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658925",
      "    gameID    REG_SZ    1207658925", "    gameName    REG_SZ    Expansion Pass", "    path    REG_SZ    D:\\GOG Games\\The Witcher 3", "    dependsOn    REG_SZ    1207658924", "",
    ].join("\r\n");
    expect(gogGames(parseRegQuery(output))).toEqual([{ id: "gog:1207658924", name: "The Witcher 3: Wild Hunt", source: "gog", dir: "D:\\GOG Games\\The Witcher 3\\" }]);
  });

  it("reads one value of one key, spaces in the value included", () => {
    const keys = parseRegQuery("\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    g:/program files (x86)/steam\r\n\r\n");
    expect([...keys.values()][0]?.SteamPath).toBe("g:/program files (x86)/steam");
    expect(parseRegQuery("ERROR: The system was unable to find the specified registry key or value.").size).toBe(0);
  });
});

describe("Xbox", () => {
  const utf16 = (text: string) => [...text].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]);

  it("reads the games folder of a drive", () => {
    expect(xboxRootFolder(new Uint8Array([0x52, 0x47, 0x42, 0x58, 1, 0, 0, 0, ...utf16("XboxGames"), 0, 0]))).toBe("XboxGames");
    expect(xboxRootFolder(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(xboxRootFolder(new Uint8Array([0x52, 0x47, 0x42, 0x58, 1, 0, 0, 0, ...utf16("..\\Windows"), 0, 0]))).toBeNull();
  });

  it("takes a game with something to start and leaves add-on packs out", () => {
    const config = `<Game><Identity Name="X" /><ExecutableList><Executable Name="game.exe" Id="Game" /></ExecutableList><ShellVisuals DefaultDisplayName="Forza &amp; Friends" StoreLogo="a.png" /><StoreId>9nblggh4r315</StoreId></Game>`;
    expect(xboxGame(config, "Forza", "H:\\XboxGames\\Forza\\Content")).toEqual({ id: "xbox:9NBLGGH4R315", name: "Forza & Friends", source: "xbox", dir: "H:\\XboxGames\\Forza\\Content\\" });
    expect(xboxGame(`<Game><ShellVisuals DefaultDisplayName="BO6 DLC07" /><StoreId>9MVTS5ZKWLV4</StoreId></Game>`, "BO6 DLC07", "H:\\X\\Content")).toBeNull();
    expect(xboxGame(config.replace("Forza &amp; Friends", "ms-resource:AppName"), "Forza Horizon", "H:\\X\\Content")?.name).toBe("Forza Horizon");
  });
});

describe("folderPath", () => {
  it("uses backslashes and exactly one at the end", () => {
    expect(folderPath("F:/Epic Games/x/")).toBe("F:\\Epic Games\\x\\");
    expect(folderPath("C:\\a\\\\")).toBe("C:\\a\\");
  });
});

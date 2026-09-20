import { describe, expect, it } from "vitest";
import type { InstalledGame } from "./launchers";
import { customId, detectedGames, gameOfPath, readGameWatch, watchLine } from "./match";

const installed: InstalledGame[] = [
  { id: "steam:730", name: "Counter-Strike 2", source: "steam", dir: "G:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\" },
  { id: "epic:Sugar", name: "Rocket League", source: "epic", dir: "F:\\Epic Games\\rocketleague\\" },
  { id: "steam:1", name: "Nested", source: "steam", dir: "F:\\Epic Games\\rocketleague\\mods\\nested\\" },
];
const custom = [{ path: "D:\\Spiele\\Alt\\alt.exe", name: "Altes Spiel" }];

describe("readGameWatch", () => {
  it("keeps a switch and well-formed executables, with a name for each", () => {
    expect(readGameWatch({ enabled: true, custom: [{ path: "D:/Spiele/Alt/alt.exe", name: "  Altes Spiel  " }, { path: "D:\\x\\y.exe", name: "" }] }))
      .toEqual({ enabled: true, custom: [{ path: "D:\\Spiele\\Alt\\alt.exe", name: "Altes Spiel" }, { path: "D:\\x\\y.exe", name: "y" }] });
  });

  it("drops what is no full path of an executable, what would break the helper's line, and doubles", () => {
    const bad = ["relative\\game.exe", "D:\\a\\..\\b.exe", "D:\\a\\b.txt", "D:\\a\tb\\c.exe", "\\\\server\\share\\a.exe", "D:\\a\\b.exe\nwatch"];
    expect(readGameWatch({ enabled: true, custom: [...bad.map((path) => ({ path, name: "x" })), { path: "D:\\ok.exe", name: "a" }, { path: "d:\\OK.exe", name: "b" }, 7, null] }).custom).toEqual([{ path: "D:\\ok.exe", name: "a" }]);
    expect(readGameWatch(null)).toEqual({ enabled: false, custom: [] });
    expect(readGameWatch({ enabled: "yes" }).enabled).toBe(false);
  });
});

describe("watchLine", () => {
  it("names the games' folders and the added programs, and nothing while detection is off", () => {
    expect(watchLine(installed, { enabled: true, custom })).toBe(["watch", ...installed.map((g) => g.dir), "D:\\Spiele\\Alt\\alt.exe"].join("\t"));
    expect(watchLine(installed, { enabled: false, custom })).toBe("watch");
    expect(watchLine([], { enabled: true, custom: [] })).toBe("watch");
  });
});

describe("gameOfPath", () => {
  it("finds the installation that holds an executable, whatever the case, and the deepest one", () => {
    expect(gameOfPath("g:\\steam\\STEAMAPPS\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe", installed, custom)).toEqual({ id: "steam:730", name: "Counter-Strike 2" });
    expect(gameOfPath("F:\\Epic Games\\rocketleague\\mods\\nested\\n.exe", installed, custom)).toEqual({ id: "steam:1", name: "Nested" });
    expect(gameOfPath("F:\\Epic Games\\rocketleague\\Binaries\\Win64\\RocketLeague.exe", installed, custom)?.id).toBe("epic:Sugar");
  });

  it("knows an added program by its exact path and nothing else", () => {
    expect(gameOfPath("d:\\spiele\\alt\\ALT.exe", installed, custom)).toEqual({ id: customId("D:\\Spiele\\Alt\\alt.exe"), name: "Altes Spiel" });
    expect(gameOfPath("D:\\Spiele\\Alt\\other.exe", installed, custom)).toBeNull();
    expect(gameOfPath("C:\\Windows\\explorer.exe", installed, custom)).toBeNull();
  });
});

describe("detectedGames", () => {
  it("lists installed games and added programs by name, without paths", () => {
    expect(detectedGames([...installed, installed[0]!], custom)).toEqual([
      { id: customId("D:\\Spiele\\Alt\\alt.exe"), name: "Altes Spiel", source: "custom" },
      { id: "steam:730", name: "Counter-Strike 2", source: "steam" },
      { id: "steam:1", name: "Nested", source: "steam" },
      { id: "epic:Sugar", name: "Rocket League", source: "epic" },
    ]);
  });
});

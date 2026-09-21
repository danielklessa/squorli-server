import { describe, expect, it } from "vitest";
import { GameDetection, mergeHidden, readGameSettings, shownGame, syncedHidden } from "./gameDetection";
import type { GameWatchSettings, RunningGame } from "./platform/bridge";

function setup(stored: string | null = null, enabled = true) {
  const saved: string[] = [];
  const watches: GameWatchSettings[] = [];
  let emit: (game: RunningGame | null) => void = () => {};
  const games = new GameDetection({
    scan: async () => [], pickProgram: async () => null,
    setWatch: (settings) => { watches.push(settings); },
    subscribe: (cb) => { emit = cb; return () => { emit = () => {}; }; },
  }, { getItem: () => stored, setItem: (_key, value) => { saved.push(value); } });
  games.setEnabled(enabled);
  watches.length = 0;
  const stop = games.start();
  return { games, saved, watches, stop, restart: () => games.start(), emit: (game: RunningGame | null) => emit(game) };
}

describe("readGameSettings", () => {
  it("starts empty, whatever was stored", () => {
    for (const raw of [null, "", "not json", "7", "[]", "{\"enabled\":true,\"hidden\":5,\"custom\":{}}"]) expect(readGameSettings(raw)).toEqual({ hidden: [], custom: [], hiddenSynced: false });
  });

  it("keeps the hidden ids once each and well-formed programs; the switch is not stored here", () => {
    expect(readGameSettings(JSON.stringify({ enabled: true, hidden: ["steam:431960", "steam:431960", 7, ""], custom: [{ path: "D:\\a.exe", name: "A" }, { path: 3 }, null] })))
      .toEqual({ hidden: ["steam:431960"], custom: [{ path: "D:\\a.exe", name: "A" }], hiddenSynced: false });
  });
});

describe("shownGame", () => {
  const running = { id: "steam:730", name: "Counter-Strike 2" };
  it("shows the running game only while detection is on and the game is not hidden", () => {
    expect(shownGame(true, { hidden: [], custom: [], hiddenSynced: false }, running)).toEqual(running);
    expect(shownGame(false, { hidden: [], custom: [], hiddenSynced: false }, running)).toBeNull();
    expect(shownGame(true, { hidden: ["steam:730"], custom: [], hiddenSynced: false }, running)).toBeNull();
    expect(shownGame(true, { hidden: [], custom: [], hiddenSynced: false }, null)).toBeNull();
  });
});

describe("GameDetection", () => {
  it("tells the shell at the start what applies, and again when the switch or the programs change", () => {
    const { games, watches, saved } = setup(JSON.stringify({ hidden: [], custom: [{ path: "D:\\a.exe", name: "A" }] }));
    expect(watches).toEqual([{ enabled: true, custom: [{ path: "D:\\a.exe", name: "A" }] }]);
    games.setEnabled(false);
    games.setEnabled(false); // no change: the shell is not told twice
    games.addCustom({ path: "d:\\A.exe", name: "A again" });
    expect(watches.slice(1)).toEqual([{ enabled: false, custom: [{ path: "D:\\a.exe", name: "A" }] }, { enabled: false, custom: [{ path: "d:\\A.exe", name: "A again" }] }]);
    expect(JSON.parse(saved.at(-1)!)).toEqual({ hidden: [], custom: [{ path: "d:\\A.exe", name: "A again" }], hiddenSynced: false });
  });

  it("is off until it is switched on", () => {
    const { games, watches, emit } = setup(null, false);
    expect(watches).toEqual([{ enabled: false, custom: [] }]);
    emit({ id: "steam:730", name: "Counter-Strike 2" });
    expect(games.state).toMatchObject({ enabled: false, shown: null });
    games.setEnabled(true);
    expect(games.state.shown?.id).toBe("steam:730");
  });

  it("listens again after it was stopped and started once more (an effect that runs twice)", () => {
    const { games, watches, stop, restart, emit } = setup();
    stop();
    restart();
    emit({ id: "steam:730", name: "Counter-Strike 2" });
    expect(games.state.shown?.id).toBe("steam:730");
    expect(watches).toHaveLength(2);
  });

  it("hides a game without asking the shell, and forgets an added program with its hidden mark", () => {
    const { games, watches, emit } = setup(JSON.stringify({ hidden: [], custom: [{ path: "D:\\a.exe", name: "A" }] }));
    let changes = 0;
    games.subscribe(() => { changes++; });
    emit({ id: "custom:d:\\a.exe", name: "A" });
    expect(games.state.shown?.name).toBe("A");
    games.setHidden("custom:d:\\a.exe", true);
    expect(games.state).toMatchObject({ running: { name: "A" }, shown: null });
    expect(watches).toHaveLength(1);
    expect(games.customOf("custom:d:\\a.exe")?.path).toBe("D:\\a.exe");
    games.removeCustom("D:\\a.exe");
    expect(games.state.settings).toEqual({ hidden: [], custom: [], hiddenSynced: false });
    expect(changes).toBe(3);
  });

  it("joins its hide list with the account's while it holds something the account has not seen, and follows the account's after that", () => {
    const { games, saved } = setup(JSON.stringify({ hidden: ["steam:10", "custom:d:\\a.exe"], custom: [{ path: "D:\\a.exe", name: "A" }] }));
    games.adoptHidden(["steam:20"]);
    expect(games.state.settings).toMatchObject({ hidden: ["custom:d:\\a.exe", "steam:20", "steam:10"], hiddenSynced: true });
    // In step now: the account's list replaces the launcher ids (a tick set on another computer), the added program's mark stays.
    games.adoptHidden(["steam:20"]);
    expect(games.state.settings.hidden).toEqual(["custom:d:\\a.exe", "steam:20"]);
    const writes = saved.length;
    games.adoptHidden(["steam:20"]);
    expect(saved).toHaveLength(writes);
    // A change made here is not in step until the account's list comes back with it; a status that arrives before joins, so the hidden game stays hidden.
    games.setHidden("steam:30", true);
    expect(games.state.settings.hiddenSynced).toBe(false);
    games.adoptHidden(["steam:20"]);
    expect(games.state.settings).toMatchObject({ hidden: ["custom:d:\\a.exe", "steam:20", "steam:30"], hiddenSynced: true });
  });
});

describe("the hide list that follows the account", () => {
  it("carries launcher ids only: never an added program (its id is its path), nothing overlong", () => {
    expect(syncedHidden(["steam:730", "custom:d:\\spiele\\a.exe", "epic:Fortnite", `epic:${"x".repeat(80)}`])).toEqual(["steam:730", "epic:Fortnite"]);
  });
  it("merges without touching the programs and without doubles", () => {
    const settings = { hidden: ["steam:1", "custom:c:\\a.exe"], custom: [{ path: "C:\\a.exe", name: "A" }], hiddenSynced: false };
    expect(mergeHidden(settings, ["steam:1", "gog:2"])).toEqual({ ...settings, hidden: ["custom:c:\\a.exe", "steam:1", "gog:2"], hiddenSynced: true });
    expect(mergeHidden({ ...settings, hiddenSynced: true }, [])).toEqual({ ...settings, hidden: ["custom:c:\\a.exe"], hiddenSynced: true });
  });
});

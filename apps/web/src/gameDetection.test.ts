import { describe, expect, it } from "vitest";
import { GameDetection, readGameSettings, shownGame } from "./gameDetection";
import type { GameWatchSettings, RunningGame } from "./platform/bridge";

function setup(stored: string | null = null) {
  const saved: string[] = [];
  const watches: GameWatchSettings[] = [];
  let emit: (game: RunningGame | null) => void = () => {};
  const games = new GameDetection({
    scan: async () => [], pickProgram: async () => null,
    setWatch: (settings) => { watches.push(settings); },
    subscribe: (cb) => { emit = cb; return () => { emit = () => {}; }; },
  }, { getItem: () => stored, setItem: (_key, value) => { saved.push(value); } });
  const stop = games.start();
  return { games, saved, watches, stop, restart: () => games.start(), emit: (game: RunningGame | null) => emit(game) };
}

describe("readGameSettings", () => {
  it("starts switched off and empty, whatever was stored", () => {
    for (const raw of [null, "", "not json", "7", "[]", "{\"enabled\":\"yes\",\"hidden\":5,\"custom\":{}}"]) expect(readGameSettings(raw)).toEqual({ enabled: false, hidden: [], custom: [] });
  });

  it("keeps the switch, the hidden ids once each, and well-formed programs", () => {
    expect(readGameSettings(JSON.stringify({ enabled: true, hidden: ["steam:431960", "steam:431960", 7, ""], custom: [{ path: "D:\\a.exe", name: "A" }, { path: 3 }, null] })))
      .toEqual({ enabled: true, hidden: ["steam:431960"], custom: [{ path: "D:\\a.exe", name: "A" }] });
  });
});

describe("shownGame", () => {
  const running = { id: "steam:730", name: "Counter-Strike 2" };
  it("shows the running game only while detection is on and the game is not hidden", () => {
    expect(shownGame({ enabled: true, hidden: [], custom: [] }, running)).toEqual(running);
    expect(shownGame({ enabled: false, hidden: [], custom: [] }, running)).toBeNull();
    expect(shownGame({ enabled: true, hidden: ["steam:730"], custom: [] }, running)).toBeNull();
    expect(shownGame({ enabled: true, hidden: [], custom: [] }, null)).toBeNull();
  });
});

describe("GameDetection", () => {
  it("tells the shell at the start what is stored, and again when the switch or the programs change", () => {
    const { games, watches, saved } = setup(JSON.stringify({ enabled: true, hidden: [], custom: [{ path: "D:\\a.exe", name: "A" }] }));
    expect(watches).toEqual([{ enabled: true, custom: [{ path: "D:\\a.exe", name: "A" }] }]);
    games.setEnabled(false);
    games.addCustom({ path: "d:\\A.exe", name: "A again" });
    expect(watches.slice(1)).toEqual([{ enabled: false, custom: [{ path: "D:\\a.exe", name: "A" }] }, { enabled: false, custom: [{ path: "d:\\A.exe", name: "A again" }] }]);
    expect(JSON.parse(saved.at(-1)!)).toMatchObject({ enabled: false, custom: [{ path: "d:\\A.exe", name: "A again" }] });
  });

  it("listens again after it was stopped and started once more (an effect that runs twice)", () => {
    const { games, watches, stop, restart, emit } = setup(JSON.stringify({ enabled: true, hidden: [], custom: [] }));
    stop();
    restart();
    emit({ id: "steam:730", name: "Counter-Strike 2" });
    expect(games.state.shown?.id).toBe("steam:730");
    expect(watches).toHaveLength(2);
  });

  it("hides a game without asking the shell, and forgets an added program with its hidden mark", () => {
    const { games, watches, emit } = setup(JSON.stringify({ enabled: true, hidden: [], custom: [{ path: "D:\\a.exe", name: "A" }] }));
    let changes = 0;
    games.subscribe(() => { changes++; });
    emit({ id: "custom:d:\\a.exe", name: "A" });
    expect(games.state.shown?.name).toBe("A");
    games.setHidden("custom:d:\\a.exe", true);
    expect(games.state).toMatchObject({ running: { name: "A" }, shown: null });
    expect(watches).toHaveLength(1);
    expect(games.customOf("custom:d:\\a.exe")?.path).toBe("D:\\a.exe");
    games.removeCustom("D:\\a.exe");
    expect(games.state.settings).toEqual({ enabled: true, hidden: [], custom: [] });
    expect(changes).toBe(3);
  });
});

import type { DirectoryGame } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { GAME_LOOKUP_RETRY_MS, directoryGameLookup, presenceOf, shownGameOf, type GameLookup } from "./gamePresence";

const game = (over: Partial<DirectoryGame> = {}): DirectoryGame => ({ id: "steam:730", name: "Counter-Strike 2", show: true, iconUpdatedAt: null, ...over });
const answers = (answer: Awaited<ReturnType<GameLookup>>): GameLookup => async () => answer;

describe("presenceOf", () => {
  it("reports a launcher's game by id, with the directory's name", async () => {
    expect(await presenceOf({ id: "steam:730", name: "Counter-Strike Global Offensive" }, answers(game()))).toEqual({ id: "steam:730", name: "Counter-Strike 2" });
  });

  it("reports nothing the directory does not call a game", async () => {
    expect(await presenceOf({ id: "steam:431960", name: "Wallpaper Engine" }, answers(game({ id: "steam:431960", name: "Wallpaper Engine", show: false })))).toBeNull();
    expect(await presenceOf(null, answers(game()))).toBeNull();
  });

  it("falls back to the name alone for an id the catalog does not know, and to id and local name when the directory cannot be asked", async () => {
    expect(await presenceOf({ id: "steam:99999999", name: "Prototype" }, answers("unknown"))).toEqual({ name: "Prototype" });
    expect(await presenceOf({ id: "steam:730", name: "CS2" }, answers(null))).toEqual({ id: "steam:730", name: "CS2" });
    expect(await presenceOf({ id: "steam:730", name: "CS2" }, null)).toEqual({ id: "steam:730", name: "CS2" });
    expect(await presenceOf({ id: "steam:730", name: "CS2" }, async () => { throw new Error("offline"); })).toEqual({ id: "steam:730", name: "CS2" });
  });

  it("never lets the id of an added program (its path) or of another source out, only the name, as one clean line", async () => {
    let asked = 0;
    const lookup: GameLookup = async () => { asked++; return game(); };
    expect(await presenceOf({ id: "custom:d:\\spiele\\alt\\alt.exe", name: "  Altes\nSpiel  " }, lookup)).toEqual({ name: "Altes Spiel" });
    expect(await presenceOf({ id: "epic:Sugar", name: "Rocket League" }, lookup)).toEqual({ name: "Rocket League" });
    expect(await presenceOf({ id: "custom:d:\\x.exe", name: "x".repeat(200) }, lookup)).toEqual({ name: "x".repeat(64) });
    expect(await presenceOf({ id: "custom:d:\\x.exe", name: " \n " }, lookup)).toBeNull();
    expect(asked).toBe(0);
  });
});

describe("directoryGameLookup", () => {
  it("asks once per id, reads 404 as unknown, and asks again a minute after a failure", async () => {
    const calls: string[] = [];
    let status = 200;
    let time = 1_000_000;
    const fetchImpl = (async (url: string) => { calls.push(url); return new Response(status === 200 ? JSON.stringify(game()) : "{}", { status }); }) as typeof fetch;
    const lookup = directoryGameLookup("https://directory.example/", fetchImpl, () => time);
    expect(lookup.peek("steam:730")).toBeUndefined();
    expect(await lookup("steam:730")).toEqual(game());
    expect(await lookup("steam:730")).toEqual(game());
    expect(lookup.peek("steam:730")).toEqual(game());
    expect(calls).toEqual(["https://directory.example/api/games/steam%3A730"]);
    status = 404;
    expect(await lookup("steam:1")).toBe("unknown");
    expect(lookup.peek("steam:1")).toBe("unknown");
    status = 429;
    expect(await lookup("steam:2")).toBeNull();
    status = 200;
    time += GAME_LOOKUP_RETRY_MS - 1;
    expect(await lookup("steam:2")).toBeNull();
    expect(lookup.peek("steam:2")).toBeUndefined();
    expect(calls).toHaveLength(3);
    time += 1;
    expect(await lookup("steam:2")).toEqual(game());
    expect(calls).toHaveLength(4);
  });
});

describe("shownGameOf", () => {
  const url = "https://directory.example";
  const reported = { id: "steam:730", name: "Totally Not CS" };

  it("shows the directory's name and icon for a launcher's game", () => {
    expect(shownGameOf(reported, game({ iconUpdatedAt: "2026-09-21T10:00:00.000Z" }), url)).toEqual({ name: "Counter-Strike 2", iconUrl: `https://directory.example/api/games/steam%3A730/icon?v=${Date.parse("2026-09-21T10:00:00.000Z")}` });
    expect(shownGameOf(reported, game(), url)).toEqual({ name: "Counter-Strike 2", iconUrl: null });
  });

  it("shows nothing the directory does not call a game, and nothing while the answer is out", () => {
    expect(shownGameOf(reported, game({ show: false }), url)).toBeNull();
    expect(shownGameOf(reported, undefined, url)).toBeNull();
    expect(shownGameOf(null, game(), url)).toBeNull();
  });

  it("shows the reported name without an icon for a game by name alone, an unknown id and a directory that cannot be asked", () => {
    expect(shownGameOf({ name: "Rocket League" }, undefined, url)).toEqual({ name: "Rocket League", iconUrl: null });
    expect(shownGameOf(reported, "unknown", url)).toEqual({ name: "Totally Not CS", iconUrl: null });
    expect(shownGameOf(reported, null, null)).toEqual({ name: "Totally Not CS", iconUrl: null });
  });
});

import type { DirectoryGame } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { directoryGameLookup, presenceOf, type GameLookup } from "./gamePresence";

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
  it("asks once per id, reads 404 as unknown, and asks again after a failure", async () => {
    const calls: string[] = [];
    let status = 200;
    const fetchImpl = (async (url: string) => { calls.push(url); return new Response(status === 200 ? JSON.stringify(game()) : "{}", { status }); }) as typeof fetch;
    const lookup = directoryGameLookup("https://directory.example/", fetchImpl);
    expect(await lookup("steam:730")).toEqual(game());
    expect(await lookup("steam:730")).toEqual(game());
    expect(calls).toEqual(["https://directory.example/api/games/steam%3A730"]);
    status = 404;
    expect(await lookup("steam:1")).toBe("unknown");
    status = 429;
    expect(await lookup("steam:2")).toBeNull();
    status = 200;
    expect(await lookup("steam:2")).toEqual(game());
    expect(calls).toHaveLength(4);
  });
});

import { describe, expect, it } from "vitest";
import { SystemWatchLines } from "./systemWatchLines";

describe("SystemWatchLines", () => {
  it("turns the helper's lines into events and skips what it does not know", () => {
    const lines = new SystemWatchLines();
    expect(lines.push("ready\r\ndisplay 0\r\ninput\r\nfuture 7\r\ndisplay 1\r\n")).toEqual([{ type: "display", required: false }, { type: "input" }, { type: "display", required: true }]);
  });

  it("waits for the rest of a line that was cut in two", () => {
    const lines = new SystemWatchLines();
    expect(lines.push("inp")).toEqual([]);
    expect(lines.push("ut\ndisp")).toEqual([{ type: "input" }]);
    expect(lines.push("lay 1\n")).toEqual([{ type: "display", required: true }]);
  });

  it("reads the game lines, paths with spaces included", () => {
    const lines = new SystemWatchLines();
    expect(lines.push("game G:\\Program Files (x86)\\Steam\\steamapps\\common\\Spiel Ä\\game.exe\r\ngame\r\n")).toEqual([{ type: "game", path: "G:\\Program Files (x86)\\Steam\\steamapps\\common\\Spiel Ä\\game.exe" }, { type: "game", path: null }]);
  });

  it("drops a line that never ends", () => {
    const lines = new SystemWatchLines();
    expect(lines.push("x".repeat(5000))).toEqual([]);
    expect(lines.push("input\n")).toEqual([{ type: "input" }]);
  });
});

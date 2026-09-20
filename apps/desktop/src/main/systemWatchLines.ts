import type { SystemActivityEvent } from "@squorli/web/platform/bridge";

/** `game`: a watched program came to the front (its executable's path), null = it has ended. It stays in the main process. */
export type SystemWatchLine = SystemActivityEvent | { type: "game"; path: string | null };

/**
 * The system watch helper's output (apps/desktop/native/system-watch) as events: one line each, "input", "display 0|1",
 * "game <path>" or "game"; anything else ("ready", a line of a newer helper) is skipped. Chunks of stdout may end in the
 * middle of a line, and of a UTF-8 character: the caller decodes with a `StringDecoder`.
 */
export class SystemWatchLines {
  private rest = "";

  push(chunk: string): SystemWatchLine[] {
    const lines = (this.rest + chunk).split("\n");
    this.rest = lines.pop() ?? "";
    // A helper gone wild must not grow this without end.
    if (this.rest.length > 4096) this.rest = "";
    return lines.flatMap((line) => { const event = parseLine(line.trim()); return event ? [event] : []; });
  }
}

function parseLine(line: string): SystemWatchLine | null {
  if (line === "input") return { type: "input" };
  if (line === "display 1") return { type: "display", required: true };
  if (line === "display 0") return { type: "display", required: false };
  if (line === "game") return { type: "game", path: null };
  if (line.startsWith("game ")) return { type: "game", path: line.slice(5) };
  return null;
}

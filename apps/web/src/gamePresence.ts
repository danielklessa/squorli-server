import { DirectoryGame, GameName, LibraryGameId, directoryGameUrl, type GamePresence } from "@squorli/protocol";
import type { RunningGame } from "./platform/bridge";

/**
 * What goes out about the running game (game display, docs/features/games.md). The detection (gameDetection.ts) says which
 * game others may see; this turns it into the `GamePresence` that is reported with the `activity` state. Three rules:
 * - an id leaves the computer only when it is a launcher's id the directory's game library can know (`LibraryGameId`). The id
 *   of an added program contains its path and never goes anywhere; such a game, and an Epic one, is reported by name alone;
 * - the directory decides what is a game: `show: false` (an application such as Wallpaper Engine, a tool, the operator's
 *   word) = nothing is reported. An id the launcher's catalog does not know is reported by name alone; when the directory
 *   cannot be asked right now, id and name go out and the viewers ask for themselves;
 * - the name is one line of at most 64 characters, the directory's when it has one.
 */
export type GameLookup = (id: string) => Promise<DirectoryGame | "unknown" | null>;

const cleanName = (name: string): string | null => {
  const parsed = GameName.safeParse(name.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 64));
  return parsed.success ? parsed.data : null;
};

export async function presenceOf(shown: RunningGame | null, lookup: GameLookup | null): Promise<GamePresence | null> {
  if (!shown) return null;
  const local = cleanName(shown.name);
  const id = LibraryGameId.safeParse(shown.id);
  if (!id.success) return local ? { name: local } : null;
  const known = lookup ? await lookup(id.data).catch(() => null) : null;
  if (known === "unknown") return local ? { name: local } : null;
  if (known && !known.show) return null;
  const name = (known ? cleanName(known.name) : null) ?? local;
  return name ? { id: id.data, name } : null;
}

/**
 * Asks the directory's game library, once per id and session (the browser's cache holds an answer for a day besides).
 * null = could not be asked (no answer, limited, a directory without the library).
 */
export function directoryGameLookup(directoryUrl: string, fetchImpl: typeof fetch = fetch): GameLookup {
  const known = new Map<string, Promise<DirectoryGame | "unknown" | null>>();
  return (id) => {
    const cached = known.get(id);
    if (cached) return cached;
    const asked = fetchImpl(directoryGameUrl(directoryUrl, id)).then(async (res) => {
      if (res.status === 404) return "unknown" as const;
      if (!res.ok) return null;
      const game = DirectoryGame.safeParse(await res.json());
      return game.success ? game.data : null;
    }, () => null).then((answer) => { if (answer === null) known.delete(id); return answer; });
    known.set(id, asked);
    return asked;
  };
}

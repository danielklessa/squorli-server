import { DirectoryGame, GameName, LibraryGameId, directoryGameIconUrl, directoryGameUrl, type GamePresence } from "@squorli/protocol";
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

/** A lookup that also says what it already knows without asking (`peek`), so a list that is drawn again does not blink. */
export type GameLibraryLookup = GameLookup & { peek: (id: string) => DirectoryGame | "unknown" | undefined };

/** A failed request leaves its id alone for this long: a member list asks for the same game from many rows. */
export const GAME_LOOKUP_RETRY_MS = 60_000;

/**
 * Asks the directory's game library, once per id and session (the browser's cache holds an answer for a day besides).
 * null = could not be asked (no answer, limited, a directory without the library); asked again after a minute at the earliest.
 */
export function directoryGameLookup(directoryUrl: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): GameLibraryLookup {
  const asked = new Map<string, Promise<DirectoryGame | "unknown" | null>>();
  const answers = new Map<string, DirectoryGame | "unknown">();
  const failedAt = new Map<string, number>();
  const lookup: GameLookup = (id) => {
    const failed = failedAt.get(id);
    if (failed !== undefined && now() - failed >= GAME_LOOKUP_RETRY_MS) { failedAt.delete(id); asked.delete(id); }
    const cached = asked.get(id);
    if (cached) return cached;
    const request = fetchImpl(directoryGameUrl(directoryUrl, id)).then(async (res) => {
      if (res.status === 404) return "unknown" as const;
      if (!res.ok) return null;
      const game = DirectoryGame.safeParse(await res.json());
      return game.success ? game.data : null;
    }, () => null).then((answer) => {
      if (answer === null) failedAt.set(id, now());
      else answers.set(id, answer);
      return answer;
    });
    asked.set(id, request);
    return request;
  };
  return Object.assign(lookup, { peek: (id: string) => answers.get(id) });
}

/** What a viewer shows of somebody's game. */
export type ShownGame = { name: string; iconUrl: string | null };

/**
 * The viewer's side: what to show of a reported game. `answer` is the directory's word about the game's id: undefined = not
 * asked yet or still asking, null = could not be asked. A game with a launcher's id shows the directory's name and icon; what
 * the directory does not call a game shows nothing, whatever the playing client says, and nothing shows while the answer is
 * still out, so such a game never flashes up. A game without an id, one the catalog does not know and one the directory
 * cannot be asked about show the reported name, which is the playing user's own text like a display name, and no icon.
 */
export function shownGameOf(game: GamePresence | null, answer: DirectoryGame | "unknown" | null | undefined, directoryUrl: string | null): ShownGame | null {
  if (!game) return null;
  if (!game.id || answer === null || answer === "unknown") return { name: game.name, iconUrl: null };
  if (answer === undefined || !answer.show) return null;
  return { name: cleanName(answer.name) ?? game.name, iconUrl: directoryUrl ? directoryGameIconUrl(directoryUrl, answer) : null };
}

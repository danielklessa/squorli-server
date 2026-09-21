import type { GamePresence } from "@squorli/protocol";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { shownGameOf, type GameLibraryLookup, type ShownGame } from "./gamePresence";
import { Icon } from "./Icon";
import { t } from "./i18n";

/**
 * The game display's viewing side (docs/features/games.md): "Spielt X" next to a member or a friend. Name and icon of a
 * launcher's game come from the directory's game library, which App.tsx hands down here; the rules are `shownGameOf`.
 */
export type GameLibraryAccess = { directoryUrl: string | null; lookup: GameLibraryLookup | null };
export const GameLibraryContext = createContext<GameLibraryAccess>({ directoryUrl: null, lookup: null });

export function useShownGame(game: GamePresence | null): ShownGame | null {
  const { directoryUrl, lookup } = useContext(GameLibraryContext);
  const id = game?.id;
  const [asked, setAsked] = useState<{ id: string; lookup: GameLibraryLookup; answer: Awaited<ReturnType<GameLibraryLookup>> } | null>(null);
  useEffect(() => {
    if (!id || !lookup || lookup.peek(id) !== undefined) return;
    let stale = false;
    void lookup(id).then((answer) => { if (!stale) setAsked({ id, lookup, answer }); });
    return () => { stale = true; };
  }, [id, lookup]);
  const answer = !id || !lookup ? null : lookup.peek(id) ?? (asked && asked.id === id && asked.lookup === lookup ? asked.answer : undefined);
  return shownGameOf(game, answer, directoryUrl);
}

/** One line: the game's icon (a gamepad where it has none) and "Spielt X". Where there is nothing to show, `fallback` (or nothing). */
export function GameLine({ game, className = "", fallback = null }: { game: GamePresence | null; className?: string; fallback?: ReactNode }) {
  const shown = useShownGame(game);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!shown) return <>{fallback}</>;
  const text = t("game.playing", { name: shown.name });
  return (
    <small className={`game-line ${className}`} title={text}>
      {shown.iconUrl && shown.iconUrl !== failedSrc
        ? <img key={shown.iconUrl} src={shown.iconUrl} alt="" width="16" height="16" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(shown.iconUrl)} />
        : <Icon name="gamepad-2" />}
      <span>{text}</span>
    </small>
  );
}

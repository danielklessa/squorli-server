import type { Member } from "@squorli/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { mentionLabel, mentionQueryAt, suggestMembers, type Picked } from "./mentions";
import { t } from "./i18n";

/**
 * Member suggestions while an "@name" is being typed in a message input. The owner calls `sync()` whenever text or
 * caret may have changed, lets `onKeyDown` see the keys first (arrows choose, Enter or Tab accept, Escape dismisses;
 * true = handled, so Enter does not send), and renders `popup` inside a positioned parent above the input.
 * `picked` remembers who was chosen for a name, for `encodeMentions` when sending; the edit field fills it first with the
 * people the message already mentions (`decodeMentions`). `below` opens the list under the input (edit field inside the
 * scrolling message list, where a list above the first message would be cut off) and scrolls it into view.
 */
export function useMentionSuggest({ inputRef, value, onChange, members, below = false }: {
  inputRef: MutableRefObject<HTMLTextAreaElement | null>; value: string; onChange: (value: string) => void; members: readonly Member[]; below?: boolean;
}): { popup: ReactNode; picked: Picked; sync: () => void; close: () => void; onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean } {
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const picked = useRef<Picked>(new Map()).current;
  /** Escape dismissed the list for the "@" at this position; typing another "@" brings it back. */
  const dismissed = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const sync = useCallback(() => {
    // After the event: the caret is where the key or click put it.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      const next = el && document.activeElement === el && el.selectionStart === el.selectionEnd ? mentionQueryAt(el.value, el.selectionStart) : null;
      if (next && next.start === dismissed.current) { setQuery(null); return; }
      if (!next) dismissed.current = null;
      // Arrow keys also end up here (keyup): the choice only starts over when the query really changed.
      const key = next ? `${next.start}:${next.query}` : "";
      if (key === lastKey.current) return;
      lastKey.current = key;
      setQuery(next);
      setIndex(0);
    });
  }, [inputRef]);
  const lastKey = useRef("");
  const close = useCallback(() => { lastKey.current = ""; setQuery(null); }, []);

  const hits = useMemo(() => (query ? suggestMembers(members, query.query) : []), [members, query]);
  const open = query !== null && hits.length > 0;
  const listEl = useRef<HTMLUListElement | null>(null);
  useEffect(() => { if (open && below) listEl.current?.scrollIntoView({ block: "nearest" }); }, [open, below, hits.length]);

  const accept = useCallback((member: Member) => {
    const el = inputRef.current;
    if (!el || !query) return;
    const label = mentionLabel(member), current = valueRef.current;
    const insert = `@${label} `;
    picked.set(label, member.userId);
    onChange(current.slice(0, query.start) + insert + current.slice(el.selectionStart));
    setQuery(null);
    const caret = query.start + insert.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  }, [inputRef, onChange, picked, query]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIndex((i) => (i + (event.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length); return true; }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") { event.preventDefault(); accept(hits[Math.min(index, hits.length - 1)]!); return true; }
    if (event.key === "Escape") { event.preventDefault(); dismissed.current = query.start; setQuery(null); return true; }
    return false;
  };

  const popup = open ? (
    <ul ref={listEl} className={below ? "mention-suggest below" : "mention-suggest"} role="listbox" aria-label={t("chat.mentionSuggest")}>
      {hits.map((m, i) => (
        // mousedown, not click: the input must keep the focus (and its caret).
        <li key={m.userId} role="option" aria-selected={i === index} className={i === index ? "active" : ""} onMouseDown={(e) => { e.preventDefault(); accept(m); }} onMouseEnter={() => setIndex(i)}>
          <Avatar name={m.displayName} /><span className="mention-suggest-name">{mentionLabel(m)}</span>
          {m.handle && m.handle !== mentionLabel(m) && <span className="muted small">@{m.handle}</span>}
        </li>
      ))}
    </ul>
  ) : null;

  return { popup, picked, sync, close, onKeyDown };
}

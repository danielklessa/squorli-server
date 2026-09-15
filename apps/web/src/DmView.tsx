import { Avatar } from "./Avatar";
import { DM_DELETE_BOTH_MS, type Friend } from "@squorli/protocol";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { askConfirm } from "./dialogs";
import { friendName } from "./Home";
import { Icon } from "./Icon";
import type { DmThread, Store } from "./store";
import { fmtDay, fmtTime, t } from "./i18n";

/**
 * Conversation with a friend (M7): history (older messages when scrolling up), grouping as in the channel chat, composer without
 * attachments. Deleting: your own messages within 5 minutes for both sides, otherwise only for me (user decision).
 */
const GROUP_MS = 5 * 60_000;
const linkRe = /(https?:\/\/[^\s<]+)/g;

function renderText(text: string) {
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line.split(linkRe).map((part, j) => (linkRe.test(part) && part.startsWith("http")
        ? <a key={j} href={part} target="_blank" rel="noreferrer noopener">{part}</a>
        : <span key={j}>{part}</span>))}
    </span>
  ));
}

export function DmView({ friend, thread, myKey, store }: { friend: Friend; thread: DmThread; myKey: string; store: Store }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const name = friendName(friend);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [thread.list]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 60 && thread.hasMore && !thread.loading && thread.loaded) {
      const before = el.scrollHeight;
      void store.loadDmHistory(friend.publicKey, true).then(() => { requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before; }); });
    }
  }

  async function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setErr(null);
    try { await store.sendDm(friend.publicKey, text); setDraft(""); stickToBottom.current = true; }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSending(false); }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
  }

  return (
    <section className="chat">
      <header className="chat-head">
        <Avatar name={name} online={friend.online} /><strong>{name}</strong>
        <span className="muted topic">@{friend.handle}{friend.online ? ` · ${t("dm.online")}` : ""}</span>
        <span className="spacer" />
        <button className="icon" title={t("dm.clearTitle")} onClick={() => { void askConfirm({ title: t("dm.clearConfirmTitle", { name }), text: t("dm.clearConfirmText"), confirmLabel: t("common.delete"), danger: true }).then((ok) => { if (ok) store.clearDm(friend.publicKey); }); }}><Icon name="trash-2" /></button>
      </header>

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {thread.loading && <p className="muted center">{t("common.loading")}</p>}
        {thread.loaded && !thread.hasMore && <p className="muted center"><Icon name="lock" /> {t("dm.e2e", { name })}</p>}
        {thread.list.map((m, i) => {
          const prev = thread.list[i - 1];
          const grouped = prev && prev.from === m.from && new Date(m.sentAt).getTime() - new Date(prev.sentAt).getTime() < GROUP_MS;
          const newDay = !prev || fmtDay(prev.sentAt) !== fmtDay(m.sentAt);
          const mine = m.from === myKey;
          const both = mine && Date.now() - new Date(m.sentAt).getTime() < DM_DELETE_BOTH_MS;
          return (
            <div key={m.id}>
              {newDay && <div className="day-sep"><span>{fmtDay(m.sentAt)}</span></div>}
              <article className={`msg ${grouped && !newDay ? "grouped" : ""}`}>
                {!(grouped && !newDay) && (
                  <div className="msg-head">
                    <Avatar name={mine ? t("dm.you") : name} />
                    <strong>{mine ? t("dm.you") : name}</strong>
                    <time className="muted" dateTime={m.sentAt}>{fmtTime(m.sentAt)}</time>
                  </div>
                )}
                <div className="msg-body">
                  {m.text === null
                    ? <p className="muted"><Icon name="lock" /> {t("dm.undecryptable")}</p>
                    : <p>{renderText(m.text)}</p>}
                </div>
                <div className="msg-actions">
                  <button className="icon" title={both ? t("dm.deleteBoth") : t("dm.deleteMine")} onClick={() => {
                    void askConfirm({ title: both ? t("dm.deleteBothTitle") : t("dm.deleteMineTitle"), text: both ? t("dm.deleteBothText") : t("dm.deleteMineText"), confirmLabel: t("common.delete"), danger: true })
                      .then((ok) => { if (ok) store.deleteDm(friend.publicKey, m.id); });
                  }}><Icon name="trash-2" /></button>
                </div>
              </article>
            </div>
          );
        })}
      </div>

      <footer className="composer">
        {err && <p className="error">{err}</p>}
        <div className="composer-row">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} rows={1} placeholder={t("dm.placeholder", { name })} disabled={sending} />
          <button onClick={submit} disabled={sending || !draft.trim()}>{t("chat.send")}</button>
        </div>
        <div className="typing" />
      </footer>
    </section>
  );
}

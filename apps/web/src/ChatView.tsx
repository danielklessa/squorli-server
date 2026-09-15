import { Avatar } from "./Avatar";
import { Permission, hasPermission, type Channel, type Member, type Message } from "@squorli/protocol";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { askConfirm } from "./dialogs";
import { Icon } from "./Icon";
import type { ChannelMessages } from "./store";
import type { ServerConnection } from "./serverConnection";
import { fmtDay, fmtTime, t } from "./i18n";

type Props = {
  channel: Channel;
  messages: ChannelMessages;
  members: Member[];
  myUserId: string;
  myPermissions: number;
  typing: Record<string, number>;
  conn: ServerConnection;
};

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

const fmtSize = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} kB` : `${n} B`);

export function ChatView({ channel, messages, members, myUserId, myPermissions, typing, conn }: Props) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastTyping = useRef(0);
  const nameOf = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName])), [members]);
  const canSend = hasPermission(myPermissions, Permission.SEND_MESSAGES);
  const canAttach = hasPermission(myPermissions, Permission.ATTACH_FILES);
  const canManage = hasPermission(myPermissions, Permission.MANAGE_MESSAGES);

  // Stay at the bottom when switching channels and on new messages, unless the user has scrolled up.
  useEffect(() => { stickToBottom.current = true; setDraft(""); setFiles([]); setEditing(null); }, [channel.id]);
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.list, channel.id]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 60 && messages.hasMore && !messages.loading && messages.loaded) {
      const before = el.scrollHeight;
      void conn.loadHistory(channel.id, true).then(() => { requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before; }); });
    }
  }

  async function submit() {
    const content = draft.trim();
    if ((!content && files.length === 0) || sending) return;
    setSending(true); setErr(null);
    try {
      await conn.sendMessage(channel.id, content, files);
      setDraft(""); setFiles([]);
      stickToBottom.current = true;
    } catch (e) {
      setErr(String(e));
    } finally { setSending(false); }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
    else if (Date.now() - lastTyping.current > 2500) { lastTyping.current = Date.now(); conn.typing(channel.id); }
  }

  async function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    try { await conn.api.editMessage(editing.id, text); setEditing(null); } catch (e) { setErr(String(e)); }
  }

  const typers = Object.entries(typing).filter(([uid, t]) => uid !== myUserId && Date.now() - t < 4000).map(([uid]) => nameOf.get(uid) ?? t("chat.someone"));

  return (
    <section className="chat">
      <header className="chat-head">
        <span className="channel-icon"><Icon name="hash" /></span><strong>{channel.name}</strong>
        {channel.topic && <span className="muted topic">{channel.topic}</span>}
      </header>

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages.loading && <p className="muted center">{t("common.loading")}</p>}
        {messages.loaded && !messages.hasMore && <p className="muted center">{t("chat.beginning", { name: channel.name })}</p>}
        {messages.list.map((m, i) => {
          const prev = messages.list[i - 1];
          const grouped = prev && prev.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
          const newDay = !prev || fmtDay(prev.createdAt) !== fmtDay(m.createdAt);
          const mine = m.authorId === myUserId;
          return (
            <div key={m.id}>
              {newDay && <div className="day-sep"><span>{fmtDay(m.createdAt)}</span></div>}
              <article className={`msg ${grouped && !newDay ? "grouped" : ""}`}>
                {!(grouped && !newDay) && (
                  <div className="msg-head">
                    <Avatar name={nameOf.get(m.authorId) ?? t("chat.formerMember")} />
                    <strong>{nameOf.get(m.authorId) ?? t("chat.formerMember")}</strong>
                    <time className="muted" dateTime={m.createdAt}>{fmtTime(m.createdAt)}</time>
                  </div>
                )}
                <div className="msg-body">
                  {editing?.id === m.id ? (
                    <div className="edit-box">
                      <textarea value={editing.text} autoFocus rows={2} onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); } if (e.key === "Escape") setEditing(null); }} />
                      <span className="muted">{t("chat.editHint")}</span>
                    </div>
                  ) : (
                    <>
                      {m.content && <p>{renderText(m.content)}{m.editedAt && <span className="muted"> {t("chat.edited")}</span>}</p>}
                      {m.attachments.map((a) => (
                        a.mimeType.startsWith("image/")
                          ? <a key={a.id} href={conn.api.abs(a.url)} target="_blank" rel="noreferrer"><img className="attachment-img" src={conn.api.abs(a.url)} alt={a.name} loading="lazy" /></a>
                          : <a key={a.id} className="attachment" href={conn.api.abs(a.url)} target="_blank" rel="noreferrer"><Icon name="paperclip" /> {a.name} <span className="muted">({fmtSize(a.size)})</span></a>
                      ))}
                    </>
                  )}
                </div>
                {(mine || canManage) && editing?.id !== m.id && (
                  <div className="msg-actions">
                    {mine && m.content && <button className="icon" title={t("chat.edit")} onClick={() => setEditing({ id: m.id, text: m.content })}><Icon name="pencil" /></button>}
                    <button className="icon" title={t("common.delete")} onClick={() => { void askConfirm({ title: t("chat.deleteTitle"), text: m.content ? m.content.slice(0, 160) + (m.content.length > 160 ? "…" : "") : t("chat.attachments", { n: m.attachments.length }), confirmLabel: t("common.delete"), danger: true }).then((ok) => { if (ok) return conn.api.deleteMessage(m.id); }).catch((e) => setErr(String(e))); }}><Icon name="trash-2" /></button>
                  </div>
                )}
              </article>
            </div>
          );
        })}
      </div>

      <footer className="composer">
        {err && <p className="error">{err}</p>}
        {files.length > 0 && (
          <div className="pending-files">
            {files.map((f, i) => <span key={i} className="chip">{f.name} <button className="icon" title={t("common.remove")} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" /></button></span>)}
          </div>
        )}
        <div className="composer-row">
          {canAttach && (
            <label className="icon-btn" title={t("chat.attach")}>
              <Icon name="paperclip" title={t("chat.attach")} /><input type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
            </label>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={canSend ? t("chat.placeholder", { name: channel.name }) : t("chat.noPermission")}
            disabled={!canSend || sending}
          />
          <button onClick={submit} disabled={!canSend || sending || (!draft.trim() && files.length === 0)}>{t("chat.send")}</button>
        </div>
        <div className="typing">{typers.length > 0 && t(typers.length === 1 ? "chat.typingOne" : "chat.typingMany", { names: typers.join(", ") })}</div>
      </footer>
    </section>
  );
}

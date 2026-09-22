import { createContext, memo, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { parseMarkdown, type Block, type Inline, type ListBlock, type TableBlock } from "./markdown";
import { t } from "./i18n";
import { isSquorliLink, openSquorliLink } from "./squorliLinks";

/**
 * Who a mention `<@userId>` is right now: the channel chat provides the names of its members and the own id (mentions of
 * yourself stand out). Without a provider (direct messages) a token stays the text it is.
 */
export const MentionContext = createContext<{ names: ReadonlyMap<string, string>; me: string } | null>(null);

function Mention({ userId }: { userId: string }) {
  const ctx = useContext(MentionContext);
  if (!ctx) return <>{`<@${userId}>`}</>;
  return <span className={userId === ctx.me ? "mention me" : "mention"}>@{(ctx.names.get(userId) ?? t("chat.formerMember")).replace(/^@+/, "")}</span>;
}

/**
 * Message text as Markdown (channel chat and direct messages). The tree from `markdown.ts` becomes React elements, never
 * HTML. Memoized: the chat views re-render on every keystroke in the composer, the messages must not be parsed again.
 */
export const MessageText = memo(function MessageText({ text, edited = false }: { text: string; edited?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const mark = edited ? <span className="muted md-edited"> {t("chat.edited")}</span> : null;
  // The "edited" mark follows the text in the same line; after a block that cannot take it (code, list, ...) it gets its own.
  const last = blocks[blocks.length - 1];
  const inline = last?.type === "paragraph" || last?.type === "heading";
  return (
    <div className={isJumbo(blocks) ? "md md-jumbo" : "md"}>
      {blocks.map((b, i) => renderBlock(b, i, inline && i === blocks.length - 1 ? mark : null))}
      {mark && !inline && <p>{mark}</p>}
    </div>
  );
});

/** A message of nothing but a few emoji is shown large. */
const JUMBO_MAX = 12;
function isJumbo(blocks: Block[]): boolean {
  const only = blocks.length === 1 ? blocks[0]! : null;
  if (only?.type !== "paragraph") return false;
  const emoji = only.children.filter((n) => n.type === "emoji").length;
  return emoji > 0 && emoji <= JUMBO_MAX && only.children.every((n) => n.type === "emoji" || n.type === "br" || (n.type === "text" && !n.text.trim()));
}

function renderBlock(b: Block, key: number, tail: ReactNode): ReactNode {
  switch (b.type) {
    case "paragraph": return <p key={key}>{renderInline(b.children)}{tail}</p>;
    case "heading": {
      // Message headings start at h3: h1/h2 belong to the page.
      const H = (["h3", "h4", "h5"] as const)[b.level - 1]!;
      return <H key={key} className={`md-h${b.level}`}>{renderInline(b.children)}{tail}</H>;
    }
    case "code": return <CodeBlock key={key} lang={b.lang} text={b.text} />;
    case "quote": return <blockquote key={key}>{b.children.map((c, i) => renderBlock(c, i, null))}</blockquote>;
    case "list": return renderList(b, key);
    case "table": return renderTable(b, key);
    case "rule": return <hr key={key} />;
  }
}

/** Code block with a button that copies exactly its content (no fence, no language) to the clipboard. */
function CodeBlock({ lang, text }: { lang: string | null; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const label = state === "copied" ? t("chat.codeCopied") : state === "failed" ? t("chat.codeCopyFailed") : t("chat.copyCode");
  return (
    <div className="md-code">
      <pre data-lang={lang ?? undefined}><code>{text}</code></pre>
      <button type="button" className={`icon md-copy ${state}`} title={label} aria-label={label} onClick={() => { void copyText(text).then((ok) => setState(ok ? "copied" : "failed")); }}>
        <Icon name={state === "copied" ? "check" : "copy"} />
      </button>
      <span className="md-copy-status" role="status">{state === "idle" ? "" : label}</span>
    </div>
  );
}

/** Clipboard API where the browser offers it (secure context), otherwise the old selection command, e.g. over plain http in a LAN. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* falls through to the selection command */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { area.remove(); }
}

function renderList(list: ListBlock, key: number): ReactNode {
  // Task list: the box shows the state as written, it cannot be ticked (that would mean editing someone's message).
  const items = list.items.map((item, i) => (
    <li key={i} className={item.checked === undefined ? undefined : "md-task"}>
      {item.checked !== undefined && <input type="checkbox" checked={item.checked} disabled readOnly aria-label={t(item.checked ? "chat.taskDone" : "chat.taskOpen")} />}
      {renderInline(item.children)}{item.sub && renderList(item.sub, 0)}
    </li>
  ));
  return list.ordered ? <ol key={key} start={list.start}>{items}</ol> : <ul key={key}>{items}</ul>;
}

/** The wrapper scrolls sideways: a wide table must not push the chat apart. */
function renderTable(table: TableBlock, key: number): ReactNode {
  const style = (c: number) => { const a = table.align[c]; return a ? { textAlign: a } : undefined; };
  return (
    <div key={key} className="md-table">
      <table>
        <thead><tr>{table.head.map((cell, c) => <th key={c} style={style(c)}>{renderInline(cell)}</th>)}</tr></thead>
        {table.rows.length > 0 && (
          <tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} style={style(c)}>{renderInline(cell)}</td>)}</tr>)}</tbody>
        )}
      </table>
    </div>
  );
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text": return n.text;
      case "br": return <br key={i} />;
      case "code": return <code key={i}>{n.text}</code>;
      // The title shows what was typed (":smile:", ":)"), so a conversion is never a riddle.
      case "emoji": return <span key={i} className="emoji" title={n.source ?? undefined}>{n.text}</span>;
      case "mention": return <Mention key={i} userId={n.userId} />;
      case "strong": return <strong key={i}>{renderInline(n.children)}</strong>;
      case "em": return <em key={i}>{renderInline(n.children)}</em>;
      case "del": return <del key={i}>{renderInline(n.children)}</del>;
      case "mark": return <mark key={i}>{renderInline(n.children)}</mark>;
      case "sub": return <sub key={i}>{renderInline(n.children)}</sub>;
      case "sup": return <sup key={i}>{renderInline(n.children)}</sup>;
      // A squorli:// link stays in this tab: the client takes it (desktop app), else the browser hands it to the system.
      case "link": return isSquorliLink(n.href)
        ? <a key={i} href={n.href} title={n.href} onClick={(e) => { if (openSquorliLink(n.href)) e.preventDefault(); }}>{renderInline(n.children)}</a>
        : <a key={i} href={n.href} title={n.href} target="_blank" rel="noreferrer noopener">{renderInline(n.children)}</a>;
    }
  });
}

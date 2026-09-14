import type { Friend, FriendSearchResult, Member } from "@squorli/protocol";
import { useEffect, useMemo, useState } from "react";
import { DmView } from "./DmView";
import { Icon } from "./Icon";
import type { State, Store } from "./store";

/**
 * Startansicht (M7, Squorli-Symbol in der Server-Leiste): links Freunde, Anfragen und Suche, rechts das Gespraech mit dem
 * ausgewaehlten Freund (Ende-zu-Ende verschluesselt ueber das Verzeichnis). Ersetzt Kanalliste, Chat und Mitgliederliste;
 * Sprache laeuft im Dock darunter weiter. Namen: der Freund gibt seinen globalen Anzeigenamen frei, sonst das Handle.
 */
export const friendName = (f: Friend) => f.displayName ?? `@${f.handle}`;

export function HomeSidebar({ state, store, members }: { state: State; store: Store; members: Member[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FriendSearchResult[]>([]);
  const friends = state.friends ?? [];
  const byKey = useMemo(() => new Map(friends.map((f) => [f.publicKey, f])), [friends]);
  const incoming = friends.filter((f) => f.state === "pending_in");
  const outgoing = friends.filter((f) => f.state === "pending_out");
  const blocked = friends.filter((f) => f.state === "blocked");
  const accepted = friends.filter((f) => f.state === "accepted").sort((a, b) => {
    const ua = state.conversations[a.publicKey]?.unread ?? 0; const ub = state.conversations[b.publicKey]?.unread ?? 0;
    if ((ua > 0) !== (ub > 0)) return ua > 0 ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    const ta = state.conversations[a.publicKey]?.lastAt ?? ""; const tb = state.conversations[b.publicKey]?.lastAt ?? "";
    if (ta !== tb) return tb < ta ? -1 : 1;
    return friendName(a).localeCompare(friendName(b));
  });

  // Suche: Handles beim Verzeichnis (Praefix, entprellt) und Namen in der Mitgliederliste des verbundenen Servers.
  const query = q.trim().replace(/^@/, "").toLowerCase();
  useEffect(() => {
    if (query.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { void store.searchHandles(query).then(setHits); }, 250);
    return () => clearTimeout(t);
  }, [query, store]);
  const me = state.identity?.publicKey;
  const localHits = query.length < 2 ? [] : members.filter((m) => m.publicKey !== me && (m.displayName.toLowerCase().includes(query) || (m.handle ?? "").includes(query))).slice(0, 10);
  const seen = new Set(localHits.map((m) => m.publicKey));
  const dirHits = hits.filter((h) => h.publicKey !== me && !seen.has(h.publicKey));

  const linkText = state.directoryLink === "connected" ? null : state.directoryLink === "connecting" ? "Verbinde mit dem Verzeichnis …" : state.directoryLinkError ?? "Keine Verbindung zum Verzeichnis.";

  return (
    <div className="home-side">
      <header className="server-head"><img className="brand-mark" src="/brand/squorli-icon-small.svg" alt="" width="22" height="22" /><strong>Freunde</strong></header>
      <div className="home-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Handle oder Name suchen" spellCheck={false} aria-label="Freund suchen" />
        {q && <button className="icon" title="Suche leeren" onClick={() => setQ("")}><Icon name="x" /></button>}
      </div>
      {linkText && <p className="muted small home-note">{linkText}</p>}
      {state.friendsError && <p className="error small home-note">{state.friendsError}</p>}
      <div className="channel-list home-list">
        {query.length >= 2 && (
          <section>
            <h3>Suche</h3>
            {localHits.length === 0 && dirHits.length === 0 && <p className="muted small home-note">Nichts gefunden. Namen werden nur auf diesem Server gesucht, Handles im Verzeichnis.</p>}
            <ul>
              {localHits.map((m) => <SearchRow key={m.publicKey} publicKey={m.publicKey} title={m.displayName} sub={m.handle ? `@${m.handle}` : "ohne Handle"} state={byKey.get(m.publicKey)?.state ?? null} canAdd={!!m.handle} store={store} />)}
              {dirHits.map((h) => <SearchRow key={h.publicKey} publicKey={h.publicKey} title={`@${h.handle}`} sub="Verzeichnis" state={byKey.get(h.publicKey)?.state ?? null} canAdd store={store} />)}
            </ul>
          </section>
        )}
        {incoming.length > 0 && (
          <section>
            <h3>Anfragen · {incoming.length}</h3>
            <ul>{incoming.map((f) => (
              <li key={f.publicKey} className="friend request">
                <span className="friend-name">@{f.handle}</span>
                <button className="icon ok" title="Annehmen" onClick={() => store.acceptFriend(f.publicKey)}><Icon name="check" /></button>
                <button className="icon danger" title="Ablehnen" onClick={() => store.declineFriend(f.publicKey)}><Icon name="x" /></button>
              </li>
            ))}</ul>
          </section>
        )}
        <section>
          <h3>Freunde · {accepted.length}</h3>
          {accepted.length === 0 && state.directoryLink === "connected" && <p className="muted small home-note">Noch keine Freunde. Suche oben nach einem Handle oder wähle in der Mitgliederliste eines Servers „Als Freund hinzufügen“ (Rechtsklick).</p>}
          <ul>{accepted.map((f) => {
            const unread = state.conversations[f.publicKey]?.unread ?? 0;
            return (
              <li key={f.publicKey} className={`channel friend ${state.currentPeer === f.publicKey ? "active" : ""} ${unread ? "unread" : ""} ${f.online ? "" : "offline"}`}>
                <button className="channel-btn" onClick={() => store.selectPeer(f.publicKey)} title={`@${f.handle}`}>
                  <span className={`presence ${f.online ? "on" : ""}`} />
                  <span className="channel-name">{friendName(f)}</span>
                  {unread > 0 && <span className="count">{unread}</span>}
                </button>
              </li>
            );
          })}</ul>
        </section>
        {outgoing.length > 0 && (
          <section>
            <h3>Gesendete Anfragen · {outgoing.length}</h3>
            <ul>{outgoing.map((f) => (
              <li key={f.publicKey} className="friend request">
                <span className="friend-name muted">@{f.handle}</span>
                <button className="icon" title="Zurückziehen" onClick={() => store.removeFriend(f.publicKey)}><Icon name="x" /></button>
              </li>
            ))}</ul>
          </section>
        )}
        {blocked.length > 0 && (
          <section>
            <h3>Blockiert · {blocked.length}</h3>
            <ul>{blocked.map((f) => (
              <li key={f.publicKey} className="friend request">
                <span className="friend-name muted">@{f.handle}</span>
                <button className="secondary small" onClick={() => store.unblockFriend(f.publicKey)}>Aufheben</button>
              </li>
            ))}</ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Suchtreffer: Freund hinzufuegen oder Zustand zeigen; ohne Handle (kein Verzeichniskonto) geht keine Anfrage. */
function SearchRow({ publicKey, title, sub, state, canAdd, store }: { publicKey: string; title: string; sub: string; state: Friend["state"] | null; canAdd: boolean; store: Store }) {
  const label = state === "accepted" ? "Freund" : state === "pending_out" ? "angefragt" : state === "pending_in" ? "möchte dein Freund sein" : state === "blocked" ? "blockiert" : null;
  return (
    <li className="friend request">
      <span className="friend-name">{title} <span className="muted small">{sub}</span></span>
      {label ? <span className="muted small">{label}</span>
        : canAdd ? <button className="icon ok" title="Als Freund hinzufügen" onClick={() => store.requestFriend(publicKey)}><Icon name="user-plus" /></button>
          : <span className="muted small" title="Ohne Handle beim Verzeichnis keine Freundschaft möglich">kein Konto</span>}
    </li>
  );
}

export function HomeMain({ state, store }: { state: State; store: Store }) {
  const friend = state.currentPeer ? (state.friends ?? []).find((f) => f.publicKey === state.currentPeer) ?? null : null;
  if (!state.currentPeer || !friend || friend.state !== "accepted") {
    return (
      <section className="chat empty home-empty">
        <img src="/brand/squorli-icon.svg" alt="" width="72" height="72" />
        <p className="muted">Wähle links einen Freund, um zu schreiben. Direktnachrichten sind Ende-zu-Ende verschlüsselt: das Verzeichnis sieht nur, dass ihr schreibt, nicht was.</p>
      </section>
    );
  }
  return <DmView key={friend.publicKey} friend={friend} thread={state.dms[friend.publicKey] ?? { list: [], hasMore: true, loaded: false, loading: false }} myKey={state.identity?.publicKey ?? ""} store={store} />;
}

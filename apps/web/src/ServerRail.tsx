import { directoryServerUrl } from "@squorli/protocol";
import { Icon } from "./Icon";
import { t } from "./i18n";

/** Entry in the server rail: `key` = key in the store (own server = the host in the address bar), `host` = host from the directory. */
export type RailServer = { key: string; host: string; name: string; sub: string | null; iconUrl: string | null };
/** Live state per server from the store: unread items, running voice connection, connection state. */
export type RailState = Record<string, { unread: boolean; voice: boolean; connection: string }>;

/**
 * Server rail on the far left (M6d): your own server and every chat server your handle has signed in on according to the
 * directory (AccountStatus.servers). A click switches the displayed server in the client (multi-server client) without leaving
 * the page; a running voice connection survives (green dot on the server it runs on). Icons come
 * exclusively from the directory (GET /api/servers/<host>/icon), never from the foreign server; without an icon, initials.
 * At the bottom: "discover servers" opens the public server directory.
 */
export function ServerRail({ servers, serverState, activeKey, onSelect, onDiscover, home }: {
  servers: RailServer[]; serverState: RailState; activeKey: string | null; onSelect: (key: string, host: string) => void; onDiscover: () => void;
  /** M7: home view (friends + direct messages); null = no directory socket (no account). badge = open requests + unread messages. */
  home: { open: boolean; badge: number; onToggle: () => void } | null;
}) {
  return (
    <nav className="rail" aria-label={t("rail.label")}>
      {home && (
        <>
          <button className={`rail-item home ${home.open ? "current" : ""}`} title={t("rail.home")} aria-current={home.open ? "page" : undefined} onClick={home.onToggle}>
            <img src="/brand/squorli-icon.svg" alt="" width="32" height="32" />
            {home.badge > 0 && <span className="rail-badge">{home.badge > 99 ? "99+" : home.badge}</span>}
          </button>
          <span className="rail-sep" />
        </>
      )}
      {servers.map((s) => {
        const st = serverState[s.key];
        return <RailEntry key={s.key} host={s.host} name={s.name} sub={s.sub} iconUrl={s.iconUrl} current={s.key === activeKey}
          voice={st?.voice ?? false} unread={st?.unread ?? false} onOpen={() => onSelect(s.key, s.host)} />;
      })}
      <span className="rail-sep" />
      <button className="rail-item discover" title={t("rail.discover")} onClick={onDiscover}><Icon name="compass" /></button>
    </nav>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}` : name.trim().slice(0, 2);
  return s.toUpperCase();
}

/** Round server entry: icon from the directory or initials. With `onOpen` a button (switch within the client), otherwise a link to the server. */
export function RailEntry({ host, name, sub, iconUrl, current, voice = false, unread = false, onOpen = null }: {
  host: string; name: string; sub: string | null; iconUrl: string | null; current: boolean; voice?: boolean; unread?: boolean; onOpen?: (() => void) | null;
}) {
  const title = `${name}${sub ? ` · ${sub}` : ""}\n${host}${voice ? `\n${t("rail.voiceConnected")}` : ""}`;
  const content = (
    <>
      {iconUrl ? <img src={iconUrl} alt="" /> : <span className="rail-initials">{initials(name)}</span>}
      {voice && <span className="rail-voice" aria-label={t("rail.voiceConnected")}><Icon name="volume-2" /></span>}
      {unread && !current && <span className="rail-unread" aria-label={t("rail.unread")} />}
    </>
  );
  const cls = `rail-item ${current ? "current" : ""}`;
  return onOpen
    ? <button className={cls} title={title} aria-current={current ? "page" : undefined} onClick={onOpen}>{content}</button>
    : <a className={cls} href={directoryServerUrl(host)} title={title}>{content}</a>;
}

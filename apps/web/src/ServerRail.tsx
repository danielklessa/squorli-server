import { directoryServerUrl } from "@squorli/protocol";
import { useEffect, useState, type MouseEvent } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";

/** Entry in the server rail: `key` = key in the store (own server = the host in the address bar), `host` = host from the directory. */
export type RailServer = { key: string; host: string; name: string; sub: string | null; iconUrl: string | null };
/** Live state per server from the store: unread items, running voice connection, connection state. */
/** `muted`: I have muted this server (no unread mark); `canMute`: the server is connected and keeps mutes. */
export type RailState = Record<string, { unread: boolean; mentions: number; voice: boolean; connection: string; muted: boolean; canMute: boolean }>;

type Menu = { key: string; host: string; name: string; x: number; y: number };

/**
 * Server rail on the far left (M6d): your own server and every chat server your handle has signed in on according to the
 * directory (AccountStatus.servers). A click switches the displayed server in the client (multi-server client) without leaving
 * the page; a running voice connection survives (green dot on the server it runs on). Icons come
 * exclusively from the directory (GET /api/servers/<host>/icon), never from the foreign server; without an icon, initials.
 * Right-click on a server opens a small menu: open, mute (no unread mark for it), and delete your account on that server
 * (through the directory).
 * At the bottom: "discover servers" opens the public server directory.
 */
export function ServerRail({ servers, serverState, activeKey, onSelect, onDiscover, onAdd, onLeave, onMute, home }: {
  servers: RailServer[]; serverState: RailState; activeKey: string | null; onSelect: (key: string, host: string) => void;
  /** Open the public server directory; null = the client knows no directory. */
  onDiscover: (() => void) | null;
  /** Add a server by address or link (client without a home server: the desktop app); null = not offered. */
  onAdd: (() => void) | null;
  /** Delete your account on `host` (asks for confirmation itself). */
  onLeave: (host: string, name: string) => void;
  /** Mute or unmute the server `key` for myself. */
  onMute: (key: string, muted: boolean) => void;
  /** M7: home view (friends + direct messages); null = no directory socket (no account). badge = open requests + unread messages. */
  home: { open: boolean; badge: number; onToggle: () => void } | null;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  // The menu closes on any click elsewhere or Escape (it is positioned at the pointer, outside the rail's scroll box).
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey); window.removeEventListener("resize", close); };
  }, [menu]);
  const openMenu = (s: RailServer) => (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ key: s.key, host: s.host, name: s.name, x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 100) });
  };
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
          voice={st?.voice ?? false} unread={st?.unread ?? false} mentions={st?.mentions ?? 0} muted={st?.muted ?? false} onOpen={() => onSelect(s.key, s.host)} onMenu={openMenu(s)} />;
      })}
      <span className="rail-sep" />
      {onAdd && <button className="rail-item discover" title={t("rail.add")} onClick={onAdd}><Icon name="plus" /></button>}
      {onDiscover && <button className="rail-item discover" title={t("rail.discover")} onClick={onDiscover}><Icon name="compass" /></button>}
      {menu && (
        <div className="rail-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="muted small rail-menu-head">{menu.name}<br />{menu.host}</div>
          <button role="menuitem" className="secondary small" onClick={() => { setMenu(null); onSelect(menu.key, menu.host); }}><Icon name="external-link" /> {t("common.open")}</button>
          {serverState[menu.key]?.canMute && (
            <button role="menuitem" className="secondary small" onClick={() => { const muted = serverState[menu.key]?.muted ?? false; setMenu(null); onMute(menu.key, !muted); }}>
              <Icon name={serverState[menu.key]?.muted ? "bell" : "bell-off"} /> {serverState[menu.key]?.muted ? t("rail.unmute") : t("rail.mute")}
            </button>
          )}
          <button role="menuitem" className="danger small" onClick={() => { setMenu(null); onLeave(menu.host, menu.name); }}><Icon name="user-x" /> {t("rail.menuLeave")}</button>
        </div>
      )}
    </nav>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}` : name.trim().slice(0, 2);
  return s.toUpperCase();
}

/** Round server entry: icon from the directory or initials. With `onOpen` a button (switch within the client), otherwise a link to the server. */
export function RailEntry({ host, name, sub, iconUrl, current, voice = false, unread = false, mentions = 0, muted = false, onOpen = null, onMenu }: {
  host: string; name: string; sub: string | null; iconUrl: string | null; current: boolean; voice?: boolean; unread?: boolean; mentions?: number; muted?: boolean; onOpen?: (() => void) | null;
  /** Right-click: context menu (rail only). */
  onMenu?: (e: MouseEvent) => void;
}) {
  const title = `${name}${sub ? ` · ${sub}` : ""}\n${host}${voice ? `\n${t("rail.voiceConnected")}` : ""}${muted ? `\n${t("rail.muted")}` : ""}`;
  const content = (
    <>
      {iconUrl ? <img src={iconUrl} alt="" /> : <span className="rail-initials">{initials(name)}</span>}
      {voice && <span className="rail-voice" aria-label={t("rail.voiceConnected")}><Icon name="volume-2" /></span>}
      {unread && !current && <span className="rail-unread" aria-label={t("rail.unread")} />}
      {mentions > 0 && !current && <span className="rail-badge rail-mentions" aria-label={t("sidebar.mentions", { n: mentions })}>{mentions > 99 ? "99+" : mentions}</span>}
    </>
  );
  const cls = `rail-item ${current ? "current" : ""} ${muted ? "muted" : ""}`;
  return onOpen
    ? <button className={cls} title={title} aria-current={current ? "page" : undefined} onClick={onOpen} onContextMenu={onMenu}>{content}</button>
    : <a className={cls} href={directoryServerUrl(host)} title={title}>{content}</a>;
}

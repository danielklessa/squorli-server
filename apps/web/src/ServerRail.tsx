import { directoryServerUrl } from "@squorli/protocol";
import { Icon } from "./Icon";

/** Eintrag der Server-Leiste: `key` = Schluessel im Store (eigener Server = Host der Adressleiste), `host` = Host aus dem Verzeichnis. */
export type RailServer = { key: string; host: string; name: string; sub: string | null; iconUrl: string | null };
/** Live-Zustand je Server aus dem Store: Ungelesenes, laufende Sprachverbindung, Verbindungszustand. */
export type RailState = Record<string, { unread: boolean; voice: boolean; connection: string }>;

/**
 * Server-Leiste ganz links (M6d): der eigene Server und alle Chat-Server, auf denen sich das eigene Handle laut Verzeichnis
 * angemeldet hat (AccountStatus.servers). Ein Klick wechselt den angezeigten Server im Client (Multi-Server-Client), ohne die
 * Seite zu verlassen; eine laufende Sprachverbindung bleibt bestehen (gruener Punkt am Server, auf dem sie laeuft). Icons kommen
 * ausschliesslich vom Verzeichnis (GET /api/servers/<host>/icon), nie vom fremden Server; ohne Icon Initialen.
 * Unten: "Server entdecken" oeffnet das oeffentliche Serververzeichnis.
 */
export function ServerRail({ servers, serverState, activeKey, onSelect, onDiscover, home }: {
  servers: RailServer[]; serverState: RailState; activeKey: string | null; onSelect: (key: string, host: string) => void; onDiscover: () => void;
  /** M7: Startansicht (Freunde + Direktnachrichten); null = kein Verzeichnis-Socket (kein Konto). badge = offene Anfragen + ungelesene Nachrichten. */
  home: { open: boolean; badge: number; onToggle: () => void } | null;
}) {
  return (
    <nav className="rail" aria-label="Meine Server">
      {home && (
        <>
          <button className={`rail-item home ${home.open ? "current" : ""}`} title="Freunde und Direktnachrichten" aria-current={home.open ? "page" : undefined} onClick={home.onToggle}>
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
      <button className="rail-item discover" title="Server entdecken: öffentliches Serververzeichnis" onClick={onDiscover}><Icon name="compass" /></button>
    </nav>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}` : name.trim().slice(0, 2);
  return s.toUpperCase();
}

/** Runder Server-Eintrag: Icon vom Verzeichnis oder Initialen. Mit `onOpen` ein Button (Wechsel im Client), sonst ein Link auf den Server. */
export function RailEntry({ host, name, sub, iconUrl, current, voice = false, unread = false, onOpen = null }: {
  host: string; name: string; sub: string | null; iconUrl: string | null; current: boolean; voice?: boolean; unread?: boolean; onOpen?: (() => void) | null;
}) {
  const title = `${name}${sub ? ` · ${sub}` : ""}\n${host}${voice ? "\nSprache verbunden" : ""}`;
  const content = (
    <>
      {iconUrl ? <img src={iconUrl} alt="" /> : <span className="rail-initials">{initials(name)}</span>}
      {voice && <span className="rail-voice" aria-label="Sprache verbunden"><Icon name="volume-2" /></span>}
      {unread && !current && <span className="rail-unread" aria-label="Ungelesen" />}
    </>
  );
  const cls = `rail-item ${current ? "current" : ""}`;
  return onOpen
    ? <button className={cls} title={title} aria-current={current ? "page" : undefined} onClick={onOpen}>{content}</button>
    : <a className={cls} href={directoryServerUrl(host)} title={title}>{content}</a>;
}

import { directoryServerIconUrl, directoryServerUrl, type AccountServer } from "@squorli/protocol";
import { Icon } from "./Icon";

/**
 * Server-Leiste ganz links (M6d): alle Chat-Server, auf denen sich das eigene Handle laut Verzeichnis angemeldet hat
 * (AccountStatus.servers). Jeder Eintrag ist ein Link auf den Server (eigene Origin; dort gilt der Schluessel des Browsers
 * oder "Mit Konto anmelden"). Icons kommen ausschliesslich vom Verzeichnis (GET /api/servers/<host>/icon, dort bei der
 * Registrierung uebernommen), nie vom fremden Server; ohne Icon Initialen. Der aktuelle Server ist markiert.
 * Unten: "Server entdecken" oeffnet das oeffentliche Serververzeichnis.
 */
export function ServerRail({ directoryUrl, servers, currentHost, onDiscover }: { directoryUrl: string; servers: AccountServer[] | null; currentHost: string | null; onDiscover: () => void }) {
  const list = (servers ?? []).slice().sort((a, b) => (b.lastSeenAt < a.lastSeenAt ? -1 : b.lastSeenAt > a.lastSeenAt ? 1 : 0));
  return (
    <nav className="rail" aria-label="Meine Server">
      {list.map((s) => <RailEntry key={s.host} host={s.host} name={s.name ?? s.host} sub={s.displayName ? `als ${s.displayName}` : null}
        iconUrl={directoryServerIconUrl(directoryUrl, s.host, s.iconUpdatedAt)} current={s.host === currentHost} />)}
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

/** Runder Server-Eintrag: Icon vom Verzeichnis oder Initialen; als Link, ausser fuer den aktuellen Server. */
export function RailEntry({ host, name, sub, iconUrl, current }: { host: string; name: string; sub: string | null; iconUrl: string | null; current: boolean }) {
  const title = `${name}${sub ? ` · ${sub}` : ""}\n${host}`;
  const content = iconUrl ? <img src={iconUrl} alt="" /> : <span className="rail-initials">{initials(name)}</span>;
  return current
    ? <span className="rail-item current" title={title} aria-current="page">{content}</span>
    : <a className="rail-item" href={directoryServerUrl(host)} title={title}>{content}</a>;
}

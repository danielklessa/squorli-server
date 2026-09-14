import { directoryServerIconUrl, directoryServerUrl, type DirectoryServer } from "@squorli/protocol";
import { useEffect, useState } from "react";
import * as api from "./api";
import { Icon } from "./Icon";
import { RailEntry } from "./ServerRail";

/**
 * Serververzeichnis (M6d): oeffentliche Liste des Verzeichnisdienstes (GET /api/servers, nur Server mit "auflisten").
 * Beitritt per Link: der Server wird in seiner eigenen Origin geoeffnet; offen = ohne Einladung betretbar.
 */
export function ServerBrowser({ directoryUrl, currentHost, onClose }: { directoryUrl: string; currentHost: string | null; onClose: () => void }) {
  const [servers, setServers] = useState<DirectoryServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirHost = new URL(directoryUrl).host;

  useEffect(() => {
    let alive = true;
    api.directoryServers(directoryUrl)
      .then((list) => { if (alive) setServers(list); })
      .catch((err) => { if (alive) setError(api.explainDirectoryError(err)); });
    return () => { alive = false; };
  }, [directoryUrl]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal browser-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Server entdecken</h2><span className="spacer" />
          <button className="icon" onClick={onClose} title="Schließen"><Icon name="x" /></button>
        </header>
        <p className="muted small" style={{ padding: "0.6rem 1.25rem 0" }}>Öffentliches Serververzeichnis von {dirHost}. Betreiber entscheiden selbst, ob ihr Server hier erscheint.</p>
        {error && <p className="error small">{error}</p>}
        {servers === null && !error && <p className="muted center">Lade …</p>}
        {servers && servers.length === 0 && <p className="muted center">Noch kein Server im Verzeichnis.</p>}
        {servers && servers.length > 0 && (
          <ul className="browser-list">
            {servers.map((s) => {
              const name = s.name ?? s.host;
              const current = s.host === currentHost;
              return (
                <li key={s.host} className="browser-item">
                  <RailEntry host={s.host} name={name} sub={null} iconUrl={directoryServerIconUrl(directoryUrl, s.host, s.iconUpdatedAt)} current={current} />
                  <div className="grow">
                    <strong>{name}</strong> <span className="muted small">{s.host}</span>
                    <p className="muted small">
                      {s.memberCount !== null && <>{s.memberCount} Mitglieder · </>}
                      {s.openJoin ? "offen, ohne Einladung betretbar" : "Beitritt nur mit Einladung"}
                    </p>
                    {s.description && <p className="small">{s.description}</p>}
                  </div>
                  {current ? <span className="muted small">Dieser Server</span> : <a className="link-btn" href={directoryServerUrl(s.host)}>Öffnen</a>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

import { AUDIO_BITRATES, PERMISSION_LABELS, Permission, hasPermission, permissionNames, type Ban, type Invite, type PermissionName, type ServerState } from "@squorli/protocol";
import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { askConfirm } from "./dialogs";
import { Icon } from "./Icon";

type Tab = "server" | "channels" | "roles" | "invites" | "bans";

/** Verwaltung: Server, Kategorien/Kanaele, Rollen, Einladungen, Bans. Aenderungen kommen per structure-Ereignis zurueck. */
export function AdminPanel({ server, onClose }: { server: ServerState; onClose: () => void }) {
  const p = server.myPermissions;
  const allTabs: { id: Tab; label: string; icon: string; ok: boolean }[] = [
    { id: "server", label: "Server", icon: "server", ok: hasPermission(p, Permission.MANAGE_SERVER) },
    { id: "channels", label: "Kanäle", icon: "hash", ok: hasPermission(p, Permission.MANAGE_CHANNELS) },
    { id: "roles", label: "Rollen", icon: "shield", ok: hasPermission(p, Permission.MANAGE_ROLES) },
    { id: "invites", label: "Einladungen", icon: "link", ok: hasPermission(p, Permission.CREATE_INVITES) },
    { id: "bans", label: "Bans", icon: "ban", ok: hasPermission(p, Permission.BAN_MEMBERS) },
  ];
  const tabs = allTabs.filter((t) => t.ok);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "invites");
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); } catch (e) { setErr(String(e)); } };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal admin-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Verwaltung</h2><span className="spacer" />
          <button className="icon" onClick={onClose} title="Schließen"><Icon name="x" /></button>
        </header>
        {/* Kategorien immer links (Vorgabe des Nutzers fuer alle kategorisierten Modals) */}
        <div className="settings-layout">
          <nav className="settings-nav">
            {tabs.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => { setTab(t.id); setErr(null); }}><Icon name={t.icon} /> {t.label}</button>)}
          </nav>
          <div className="settings-body">
            {err && <p className="error">{err}</p>}
            {tab === "server" && <ServerTab server={server} run={run} />}
            {tab === "channels" && <ChannelsTab server={server} run={run} />}
            {tab === "roles" && <RolesTab server={server} run={run} />}
            {tab === "invites" && <InvitesTab run={run} canManage={hasPermission(p, Permission.MANAGE_SERVER)} />}
            {tab === "bans" && <BansTab run={run} />}
          </div>
        </div>
      </div>
    </div>
  );
}

type RunFn = (fn: () => Promise<unknown>) => Promise<void>;

function ServerTab({ server, run }: { server: ServerState; run: RunFn }) {
  const [name, setName] = useState(server.settings.name);
  const owners = server.members.filter((m) => m.isOwner);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="stack">
      <label className="stack">Servername<input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></label>
      <button disabled={name.trim() === server.settings.name || !name.trim()} onClick={() => run(() => api.updateSettings({ name: name.trim() }))}>Speichern</button>
      <label className="check">
        <input type="checkbox" checked={server.settings.openJoin} onChange={(e) => run(() => api.updateSettings({ openJoin: e.target.checked }))} />
        Offener Server: jeder mit Schlüssel darf ohne Einladung beitreten
      </label>
      <h3>Server-Icon</h3>
      <div className="row">
        <img className="server-icon-preview" src={server.settings.iconUrl ?? "/brand/squorli-icon-small.svg"} alt="" width="48" height="48" />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(() => api.uploadServerIcon(f)); }} />
        <button className="secondary" onClick={() => fileRef.current?.click()}>Icon hochladen</button>
        {server.settings.iconUrl && <button className="secondary" onClick={() => run(() => api.deleteServerIcon())}>Entfernen</button>}
      </div>
      <span className="muted small">PNG, JPEG, WebP oder GIF bis 2 MB, am besten quadratisch. Erscheint in der Seitenleiste und als Favicon; ohne Icon steht dort das Squorli-Signet.</span>
      <h3>Eigentümer</h3>
      <p className="muted small">{owners.map((o) => o.displayName).join(", ") || "–"}. Eigentümer haben immer alle Rechte und können nicht entfernt werden. Weitere Eigentümer ernennt ein Eigentümer in der Mitgliederliste (Klick auf den Namen); der erste Eigentümer lässt sich nicht entziehen.</p>
    </div>
  );
}

function ChannelsTab({ server, run }: { server: ServerState; run: RunFn }) {
  const [catName, setCatName] = useState("");
  const [chName, setChName] = useState("");
  const [chKind, setChKind] = useState<"text" | "voice">("text");
  const [chCat, setChCat] = useState<string>("");
  const move = (kind: "channel" | "category", id: string, dir: -1 | 1) => {
    const list = kind === "channel" ? server.channels : server.categories;
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const sorted = [...list].sort((a, b) => a.position - b.position);
    const idx = sorted.indexOf(item);
    const other = sorted[idx + dir];
    if (!other) return;
    const upd = kind === "channel" ? api.updateChannel : api.updateCategory;
    void run(async () => { await upd(item.id, { position: other.position }); await upd(other.id, { position: item.position }); });
  };
  return (
    <div className="stack">
      <h3>Kategorien</h3>
      {server.categories.map((k) => (
        <div key={k.id} className="row">
          <input defaultValue={k.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== k.name) void run(() => api.updateCategory(k.id, { name: e.target.value.trim() })); }} />
          <button className="icon" title="nach oben" onClick={() => move("category", k.id, -1)}><Icon name="chevron-up" /></button>
          <button className="icon" title="nach unten" onClick={() => move("category", k.id, 1)}><Icon name="chevron-down" /></button>
          <button className="danger small" onClick={() => run(async () => { if (await askConfirm({ title: `Kategorie "${k.name}" löschen?`, text: "Die Kanäle darin bleiben erhalten und stehen danach ohne Kategorie.", confirmLabel: "Löschen", danger: true })) await api.deleteCategory(k.id); })}>Löschen</button>
        </div>
      ))}
      <div className="row">
        <input value={catName} placeholder="Neue Kategorie" onChange={(e) => setCatName(e.target.value)} />
        <button disabled={!catName.trim()} onClick={() => run(() => api.createCategory(catName.trim()).then(() => setCatName("")))}>Anlegen</button>
      </div>

      <h3>Kanäle</h3>
      {server.channels.map((c) => (
        <div key={c.id} className="row">
          <span className="channel-icon"><Icon name={c.kind === "text" ? "hash" : "volume-2"} /></span>
          <input defaultValue={c.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== c.name) void run(() => api.updateChannel(c.id, { name: e.target.value.trim() })); }} />
          {c.kind === "text" && <input defaultValue={c.topic ?? ""} placeholder="Thema" onBlur={(e) => { if ((e.target.value.trim() || null) !== c.topic) void run(() => api.updateChannel(c.id, { topic: e.target.value.trim() || null })); }} />}
          {c.kind === "voice" && (
            <>
              <select value={c.audioBitrate} title="Opus-Bitrate: 32 reicht für Sprache, 64 ist Standard, ab 96 für Musik" onChange={(e) => run(() => api.updateChannel(c.id, { audioBitrate: Number(e.target.value) }))}>
                {AUDIO_BITRATES.map((b) => <option key={b} value={b}>{b} kbit/s</option>)}
              </select>
              <label className="check" title="Stereo für Musik; schaltet Echo- und Rauschunterdrückung der Sender ab">
                <input type="checkbox" checked={c.audioStereo} onChange={(e) => run(() => api.updateChannel(c.id, { audioStereo: e.target.checked }))} /> Stereo
              </label>
            </>
          )}
          <select value={c.categoryId ?? ""} onChange={(e) => run(() => api.updateChannel(c.id, { categoryId: e.target.value || null }))}>
            <option value="">(keine Kategorie)</option>
            {server.categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <button className="icon" title="nach oben" onClick={() => move("channel", c.id, -1)}><Icon name="chevron-up" /></button>
          <button className="icon" title="nach unten" onClick={() => move("channel", c.id, 1)}><Icon name="chevron-down" /></button>
          <button className="danger small" onClick={() => run(async () => { if (await askConfirm({ title: `Kanal "${c.name}" löschen?`, text: c.kind === "text" ? "Alle Nachrichten und Anhänge in diesem Kanal werden unwiderruflich gelöscht." : "Teilnehmer im Kanal werden getrennt.", confirmLabel: "Löschen", danger: true })) await api.deleteChannel(c.id); })}>Löschen</button>
        </div>
      ))}
      <div className="row">
        <select value={chKind} onChange={(e) => setChKind(e.target.value as "text" | "voice")}><option value="text">Text</option><option value="voice">Sprache</option></select>
        <input value={chName} placeholder="Neuer Kanal" onChange={(e) => setChName(e.target.value)} />
        <select value={chCat} onChange={(e) => setChCat(e.target.value)}>
          <option value="">(keine Kategorie)</option>
          {server.categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <button disabled={!chName.trim()} onClick={() => run(() => api.createChannel({ kind: chKind, name: chName.trim(), categoryId: chCat || null }).then(() => setChName("")))}>Anlegen</button>
      </div>
    </div>
  );
}

function RolesTab({ server, run }: { server: ServerState; run: RunFn }) {
  const [sel, setSel] = useState<string | null>(server.roles.find((r) => !r.isDefault)?.id ?? server.roles[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const role = server.roles.find((r) => r.id === sel) ?? null;
  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? "#888888");
  const [perms, setPerms] = useState(role?.permissions ?? 0);
  const [position, setPosition] = useState(role?.position ?? 0);
  useEffect(() => { setName(role?.name ?? ""); setColor(role?.color ?? "#888888"); setPerms(role?.permissions ?? 0); setPosition(role?.position ?? 0); }, [role?.id, role?.name, role?.color, role?.permissions, role?.position]);
  const names = Object.keys(Permission) as PermissionName[];
  const sorted = [...server.roles].sort((a, b) => b.position - a.position);
  return (
    <div className="roles">
      <div className="roles-list">
        <ul>{sorted.map((r) => <li key={r.id}><button className={r.id === sel ? "active" : ""} style={r.color ? { color: r.color } : undefined} onClick={() => setSel(r.id)}>{r.name}{r.isDefault && <span className="muted"> (Standard)</span>}</button></li>)}</ul>
        <div className="row">
          <input value={newName} placeholder="Neue Rolle" onChange={(e) => setNewName(e.target.value)} />
          <button disabled={!newName.trim()} onClick={() => run(() => api.createRole({ name: newName.trim() }).then((r) => { setNewName(""); setSel(r.id); }))}>+</button>
        </div>
      </div>
      {role && (
        <div className="stack role-edit">
          <div className="row">
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} disabled={role.isDefault} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            {!role.isDefault && <label className="row">Position <input type="number" value={position} min={1} onChange={(e) => setPosition(Number(e.target.value))} style={{ width: "5rem" }} /></label>}
          </div>
          <div className="perm-grid">
            {names.map((n) => (
              <label key={n} className="check">
                <input type="checkbox" checked={(perms & Permission[n]) !== 0} onChange={(e) => setPerms(e.target.checked ? perms | Permission[n] : perms & ~Permission[n])} />
                {PERMISSION_LABELS[n]}
              </label>
            ))}
          </div>
          <p className="muted small">Aktiv: {permissionNames(perms).join(", ") || "keine"}</p>
          <div className="row">
            <button onClick={() => run(() => api.updateRole(role.id, { name: name.trim() || role.name, color, permissions: perms, ...(role.isDefault ? {} : { position }) }))}>Speichern</button>
            {!role.isDefault && <button className="danger" onClick={() => run(async () => { if (await askConfirm({ title: `Rolle "${role.name}" löschen?`, text: "Mitglieder verlieren die Rechte dieser Rolle.", confirmLabel: "Löschen", danger: true })) { await api.deleteRole(role.id); setSel(null); } })}>Löschen</button>}
          </div>
          <p className="muted small">Höhere Position = mehr Gewicht. Du kannst nur Rollen unterhalb deiner höchsten Rolle bearbeiten und nur Rechte vergeben, die du selbst hast.</p>
        </div>
      )}
    </div>
  );
}

function InvitesTab({ run, canManage }: { run: RunFn; canManage: boolean }) {
  const [list, setList] = useState<Invite[]>([]);
  const [hours, setHours] = useState<string>("168");
  const [uses, setUses] = useState<string>("");
  const reload = () => api.listInvites().then(setList).catch(() => {});
  useEffect(() => { void reload(); }, []);
  const link = (code: string) => `${window.location.origin}/invite/${code}`;
  return (
    <div className="stack">
      <div className="row">
        <label className="row">Gültig (Stunden, leer = unbegrenzt) <input value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: "5rem" }} /></label>
        <label className="row">Max. Nutzungen (leer = unbegrenzt) <input value={uses} onChange={(e) => setUses(e.target.value)} style={{ width: "5rem" }} /></label>
        <button onClick={() => run(() => api.createInvite({ expiresInHours: hours ? Number(hours) : null, maxUses: uses ? Number(uses) : null }).then(reload))}>Einladung erstellen</button>
      </div>
      {list.length === 0 && <p className="muted">Keine aktiven Einladungen{canManage ? "" : " von dir"}.</p>}
      {list.map((i) => (
        <div key={i.code} className="row invite-row">
          <code>{link(i.code)}</code>
          <button className="secondary small" onClick={() => navigator.clipboard?.writeText(link(i.code))}>Kopieren</button>
          <span className="muted small">{i.uses}{i.maxUses ? `/${i.maxUses}` : ""} genutzt{i.expiresAt ? ` · bis ${new Date(i.expiresAt).toLocaleString()}` : ""}</span>
          <button className="danger small" onClick={() => run(() => api.revokeInvite(i.code).then(reload))}>Widerrufen</button>
        </div>
      ))}
    </div>
  );
}

function BansTab({ run }: { run: RunFn }) {
  const [list, setList] = useState<Ban[]>([]);
  const reload = () => api.listBans().then(setList).catch(() => {});
  useEffect(() => { void reload(); }, []);
  return (
    <div className="stack">
      {list.length === 0 && <p className="muted">Keine Bans.</p>}
      {list.map((b) => (
        <div key={b.userId} className="row">
          <strong>{b.displayName}</strong>
          <span className="muted small">{b.reason ?? "ohne Grund"} · {new Date(b.createdAt).toLocaleString()}</span>
          <button className="secondary small" onClick={() => run(() => api.unban(b.userId).then(reload))}>Aufheben</button>
        </div>
      ))}
    </div>
  );
}

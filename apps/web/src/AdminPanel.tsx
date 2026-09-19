import { PERMISSION_GROUPS, Permission, hasPermission, type Ban, type Invite, type PermissionName, type ServerState } from "@squorli/protocol";
import { useEffect, useRef, useState } from "react";
import type { ServerApi } from "./api";
import { askConfirm } from "./dialogs";
import { roleOrder } from "./roleOrder";
import { ChannelsTab } from "./ChannelsTab";
import { RadioTab } from "./RadioTab";
import { Icon } from "./Icon";
import { fmtDateTime, t } from "./i18n";

type Tab = "server" | "channels" | "radio" | "roles" | "invites" | "bans";

/** Admin area: server, categories/channels, radio stations, roles, invites, bans. Changes come back via the structure event. */
export function AdminPanel({ api, server, myUserId, directoryUrl, onClose }: { api: ServerApi; server: ServerState; myUserId: string; directoryUrl: string | null; onClose: () => void }) {
  const p = server.myPermissions;
  const [mobileFocus] = useState(() => window.matchMedia("(max-width: 700px), (pointer: coarse)").matches);
  const allTabs: { id: Tab; label: string; icon: string; ok: boolean }[] = [
    { id: "server", label: t("admin.tab.server"), icon: "server", ok: hasPermission(p, Permission.MANAGE_SERVER) },
    { id: "channels", label: t("admin.tab.channels"), icon: "hash", ok: hasPermission(p, Permission.MANAGE_CHANNELS) },
    // Only against a server that knows the radio (older servers send no station list).
    { id: "radio", label: t("admin.tab.radio"), icon: "radio", ok: hasPermission(p, Permission.MANAGE_SERVER) && server.radioStations !== undefined },
    { id: "roles", label: t("admin.tab.roles"), icon: "shield", ok: hasPermission(p, Permission.MANAGE_ROLES) },
    { id: "invites", label: t("admin.tab.invites"), icon: "link", ok: hasPermission(p, Permission.CREATE_INVITES) },
    { id: "bans", label: t("admin.tab.bans"), icon: "ban", ok: hasPermission(p, Permission.BAN_MEMBERS) },
  ];
  const tabs = allTabs.filter((t) => t.ok);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "invites");
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); } catch (e) { setErr(String(e)); } };

  return (
    <div className="modal-backdrop admin-backdrop" onClick={onClose}>
      <div className="modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="admin-title">{t("admin.title")}</h2><span className="spacer" />
          <button className="icon" autoFocus={mobileFocus} onClick={onClose} title={t("common.close")}><Icon name="x" /></button>
        </header>
        {/* categories always on the left (as the user specified for all categorized modals) */}
        <div className="settings-layout">
          <nav className="settings-nav">
            {tabs.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => { setTab(t.id); setErr(null); }}><Icon name={t.icon} /> <span>{t.label}</span></button>)}
          </nav>
          <div className="settings-body">
            {err && <p className="error">{err}</p>}
            {tab === "server" && <ServerTab api={api} server={server} directoryUrl={directoryUrl} run={run} />}
            {tab === "channels" && <ChannelsTab api={api} server={server} run={run} />}
            {tab === "radio" && <RadioTab api={api} server={server} run={run} />}
            {tab === "roles" && <RolesTab api={api} server={server} myUserId={myUserId} run={run} />}
            {tab === "invites" && <InvitesTab api={api} run={run} canManage={hasPermission(p, Permission.MANAGE_SERVER)} />}
            {tab === "bans" && <BansTab api={api} run={run} />}
          </div>
        </div>
      </div>
    </div>
  );
}

type RunFn = (fn: () => Promise<unknown>) => Promise<void>;

function ServerTab({ api, server, directoryUrl, run }: { api: ServerApi; server: ServerState; directoryUrl: string | null; run: RunFn }) {
  const [name, setName] = useState(server.settings.name);
  const [description, setDescription] = useState(server.settings.description ?? "");
  const owners = server.members.filter((m) => m.isOwner);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="stack">
      <label className="stack">{t("admin.serverName")}<input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></label>
      <button disabled={name.trim() === server.settings.name || !name.trim()} onClick={() => run(() => api.updateSettings({ name: name.trim() }))}>{t("common.save")}</button>
      <label className="check">
        <input type="checkbox" checked={server.settings.openJoin} onChange={(e) => run(() => api.updateSettings({ openJoin: e.target.checked }))} />
        {t("admin.openJoin")}
      </label>
      <label className="check">
        <input type="checkbox" checked={server.settings.requireAccount} disabled={!directoryUrl || server.settings.requireAccountLocked} onChange={(e) => run(() => api.updateSettings({ requireAccount: e.target.checked }))} />
        {t("admin.requireAccount")}
      </label>
      {!directoryUrl && <span className="muted small">{t("admin.noDirectoryAccounts")}</span>}
      {directoryUrl && server.settings.requireAccountLocked && <span className="muted small">{t("admin.requireAccountLocked")}</span>}
      <h3>{t("admin.directoryHeading")}</h3>
      <label className="check">
        <input type="checkbox" checked={server.settings.listed} disabled={!directoryUrl} onChange={(e) => run(() => api.updateSettings({ listed: e.target.checked }))} />
        {t("admin.listed")}
      </label>
      <label className="stack">{t("admin.description")}<textarea value={description} maxLength={200} rows={3} disabled={!directoryUrl} placeholder={t("admin.descriptionPlaceholder")} onChange={(e) => setDescription(e.target.value)} /></label>
      <button disabled={!directoryUrl || (description.trim() || null) === server.settings.description} onClick={() => run(() => api.updateSettings({ description: description.trim() || null }))}>{t("admin.saveDescription")}</button>
      {!directoryUrl && <span className="muted small">{t("admin.noDirectoryListing")}</span>}
      <h3>{t("admin.iconHeading")}</h3>
      <div className="row">
        <img className="server-icon-preview" src={server.settings.iconUrl ? api.abs(server.settings.iconUrl) : "/brand/squorli-icon-small.svg"} alt="" width="48" height="48" />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(() => api.uploadServerIcon(f)); }} />
        <button className="secondary" onClick={() => fileRef.current?.click()}>{t("admin.uploadIcon")}</button>
        {server.settings.iconUrl && <button className="secondary" onClick={() => run(() => api.deleteServerIcon())}>{t("common.remove")}</button>}
      </div>
      <span className="muted small">{t("admin.iconHint")}</span>
      <h3>{t("admin.ownersHeading")}</h3>
      <p className="muted small">{owners.map((o) => o.displayName).join(", ") || "–"}. {t("admin.ownersHint")}</p>
    </div>
  );
}

function RolesTab({ api, server, myUserId, run }: { api: ServerApi; server: ServerState; myUserId: string; run: RunFn }) {
  const [sel, setSel] = useState<string | null>(server.roles.find((r) => !r.isDefault)?.id ?? server.roles[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const role = server.roles.find((r) => r.id === sel) ?? null;
  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? "#888888");
  const [perms, setPerms] = useState(role?.permissions ?? 0);

  useEffect(() => { setName(role?.name ?? ""); setColor(role?.color ?? "#888888"); setPerms(role?.permissions ?? 0); }, [role?.id, role?.name, role?.color, role?.permissions]);
  // Active permissions in the same order as the groups below.
  const active: PermissionName[] = PERMISSION_GROUPS.flatMap((g) => [...g.permissions]).filter((n) => (perms & Permission[n]) !== 0);
  const sorted = [...server.roles].sort((a, b) => b.position - a.position);
  const me = server.members.find((m) => m.userId === myUserId);
  const ceiling = me?.isOwner || server.settings.ownerId === myUserId ? Infinity : Math.max(0, ...server.roles.filter((r) => me?.roleIds.includes(r.id)).map((r) => r.position));
  const editable = sorted.filter((r) => !r.isDefault && r.position < ceiling);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const reorder = (id: string, target: string, after: boolean) => {
    if (busy.current) return;
    const changes = roleOrder(server.roles, id, target, after, ceiling);
    if (!changes) { setNotice(t("admin.roleOrderSpace")); return; }
    if (!changes.length) return;
    busy.current = true; setSaving(true); setNotice("");
    void run(async () => {
      try {
        for (const patch of changes) await api.updateRole(patch.id, { position: patch.position });
        setNotice(t("admin.orderSaved"));
      } finally { busy.current = false; setSaving(false); }
    });
  };
  const moveRole = (id: string, direction: -1 | 1) => {
    const target = editable[editable.findIndex((r) => r.id === id) + direction];
    if (target) reorder(id, target.id, direction === 1);
  };
  return (
    <div className="roles">
      <div className="roles-list">
        <p className="muted small">{t("admin.roleSortHint")}</p>
        <ul aria-busy={saving}>{sorted.map((r) => {
          const index = editable.findIndex((item) => item.id === r.id);
          return <li key={r.id} className={`role-sort-row${r.id === sel ? " active" : ""}${dragId === r.id ? " is-dragging" : ""}${drop?.id === r.id ? (drop.after ? " drop-after" : " drop-before") : ""}`}
            onDragOver={(e) => {
              if (!dragId || dragId === r.id || index < 0 || saving) return;
              e.preventDefault(); e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              setDrop({ id: r.id, after: e.clientY > rect.top + rect.height / 2 });
            }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}
            onDrop={(e) => { e.preventDefault(); if (dragId && drop?.id === r.id) reorder(dragId, r.id, drop.after); setDragId(null); setDrop(null); }}>
            {index >= 0 ? <button className="icon role-drag" draggable={!saving} disabled={saving} title={t("admin.dragItem", { name: r.name })} aria-label={t("admin.dragItem", { name: r.name })}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", r.id); if (e.currentTarget.parentElement) e.dataTransfer.setDragImage(e.currentTarget.parentElement, 16, 16); setDragId(r.id); }}
              onDragEnd={() => { setDragId(null); setDrop(null); }}
              onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); moveRole(r.id, e.key === "ArrowUp" ? -1 : 1); } }}><Icon name="grip-vertical" /></button> : <span className="role-fixed" title={t("admin.roleFixed")}><Icon name="lock" /></span>}
            <button className="role-select" title={r.name} aria-pressed={r.id === sel} style={r.color ? { color: r.color } : undefined} onClick={() => setSel(r.id)}>{r.name}{r.isDefault && <span className="muted small"> {t("admin.defaultRole")}</span>}</button>
            {index >= 0 && <div className="role-sort-actions">
              <button className="icon" disabled={saving || index === 0} title={t("admin.up")} aria-label={`${r.name}: ${t("admin.up")}`} onClick={() => moveRole(r.id, -1)}><Icon name="chevron-up" /></button>
              <button className="icon" disabled={saving || index === editable.length - 1} title={t("admin.down")} aria-label={`${r.name}: ${t("admin.down")}`} onClick={() => moveRole(r.id, 1)}><Icon name="chevron-down" /></button>
            </div>}
          </li>;
        })}</ul>
        <p className="muted small" role="status">{saving ? t("admin.orderSaving") : notice}</p>
        <div className="row">
          <input value={newName} placeholder={t("admin.newRole")} onChange={(e) => setNewName(e.target.value)} />
          <button disabled={saving || !newName.trim()} aria-label={t("admin.newRole")} onClick={() => run(() => api.createRole({ name: newName.trim() }).then((r) => { setNewName(""); setSel(r.id); }))}>+</button>
        </div>
      </div>
      {role && (
        <div className="stack role-edit">
          <div className="row">
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} disabled={role.isDefault} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
          {/* Grouped and ordered by meaning (PERMISSION_GROUPS in the protocol package), not by bit number. */}
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.id} className="perm-group">
              <legend>{t(`permGroup.${g.id}`)}</legend>
              <div className="perm-grid">
                {g.permissions.map((n) => (
                  <label key={n} className="check">
                    <input type="checkbox" checked={(perms & Permission[n]) !== 0} onChange={(e) => setPerms(e.target.checked ? perms | Permission[n] : perms & ~Permission[n])} />
                    {t(`perm.${n}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="muted small">{t("admin.activePerms", { list: active.join(", ") || t("admin.none") })}</p>
          <div className="row">
            <button onClick={() => run(() => api.updateRole(role.id, { name: name.trim() || role.name, color, permissions: perms }))}>{t("common.save")}</button>
            {!role.isDefault && <button className="danger" onClick={() => run(async () => { if (await askConfirm({ title: t("admin.deleteRoleTitle", { name: role.name }), text: t("admin.deleteRoleText"), confirmLabel: t("common.delete"), danger: true })) { await api.deleteRole(role.id); setSel(null); } })}>{t("common.delete")}</button>}
          </div>
          <p className="muted small">{t("admin.roleHint")}</p>
        </div>
      )}
    </div>
  );
}

function InvitesTab({ api, run, canManage }: { api: ServerApi; run: RunFn; canManage: boolean }) {
  const [list, setList] = useState<Invite[]>([]);
  const [hours, setHours] = useState<string>("168");
  const [uses, setUses] = useState<string>("");
  const reload = () => api.listInvites().then(setList).catch(() => {});
  useEffect(() => { void reload(); }, []);
  // The invite belongs to the server the panel acts on, which need not be the one serving the page (multi-server client).
  const link = (code: string) => `${api.base || window.location.origin}/invite/${code}`;
  return (
    <div className="stack">
      <div className="row">
        <label className="row">{t("admin.validHours")} <input value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: "5rem" }} /></label>
        <label className="row">{t("admin.maxUses")} <input value={uses} onChange={(e) => setUses(e.target.value)} style={{ width: "5rem" }} /></label>
        <button onClick={() => run(() => api.createInvite({ expiresInHours: hours ? Number(hours) : null, maxUses: uses ? Number(uses) : null }).then(reload))}>{t("admin.createInvite")}</button>
      </div>
      {list.length === 0 && <p className="muted">{canManage ? t("admin.noInvites") : t("admin.noInvitesMine")}</p>}
      {list.map((i) => (
        <div key={i.code} className="row invite-row">
          <code>{link(i.code)}</code>
          <button className="secondary small" onClick={() => navigator.clipboard?.writeText(link(i.code))}>{t("admin.copy")}</button>
          <span className="muted small">{i.uses}{i.maxUses ? `/${i.maxUses}` : ""} {t("admin.used")}{i.expiresAt ? ` · ${t("admin.until", { date: fmtDateTime(i.expiresAt) })}` : ""}</span>
          <button className="danger small" onClick={() => run(() => api.revokeInvite(i.code).then(reload))}>{t("admin.revoke")}</button>
        </div>
      ))}
    </div>
  );
}

function BansTab({ api, run }: { api: ServerApi; run: RunFn }) {
  const [list, setList] = useState<Ban[]>([]);
  const reload = () => api.listBans().then(setList).catch(() => {});
  useEffect(() => { void reload(); }, []);
  return (
    <div className="stack">
      {list.length === 0 && <p className="muted">{t("admin.noBans")}</p>}
      {list.map((b) => (
        <div key={b.userId} className="row">
          <strong>{b.displayName}</strong>
          <span className="muted small">{b.reason ?? t("admin.noReason")} · {fmtDateTime(b.createdAt)}</span>
          <button className="secondary small" onClick={() => run(() => api.unban(b.userId).then(reload))}>{t("admin.unban")}</button>
        </div>
      ))}
    </div>
  );
}

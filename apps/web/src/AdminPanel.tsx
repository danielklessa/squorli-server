import { AUDIO_BITRATES, Permission, hasPermission, permissionNames, type Ban, type Invite, type PermissionName, type ServerState } from "@squorli/protocol";
import { useEffect, useRef, useState } from "react";
import type { ServerApi } from "./api";
import { askConfirm } from "./dialogs";
import { Icon } from "./Icon";
import { fmtDateTime, t } from "./i18n";

type Tab = "server" | "channels" | "roles" | "invites" | "bans";

/** Admin area: server, categories/channels, roles, invites, bans. Changes come back via the structure event. */
export function AdminPanel({ api, server, directoryUrl, onClose }: { api: ServerApi; server: ServerState; directoryUrl: string | null; onClose: () => void }) {
  const p = server.myPermissions;
  const allTabs: { id: Tab; label: string; icon: string; ok: boolean }[] = [
    { id: "server", label: t("admin.tab.server"), icon: "server", ok: hasPermission(p, Permission.MANAGE_SERVER) },
    { id: "channels", label: t("admin.tab.channels"), icon: "hash", ok: hasPermission(p, Permission.MANAGE_CHANNELS) },
    { id: "roles", label: t("admin.tab.roles"), icon: "shield", ok: hasPermission(p, Permission.MANAGE_ROLES) },
    { id: "invites", label: t("admin.tab.invites"), icon: "link", ok: hasPermission(p, Permission.CREATE_INVITES) },
    { id: "bans", label: t("admin.tab.bans"), icon: "ban", ok: hasPermission(p, Permission.BAN_MEMBERS) },
  ];
  const tabs = allTabs.filter((t) => t.ok);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "invites");
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); } catch (e) { setErr(String(e)); } };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal admin-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("admin.title")}</h2><span className="spacer" />
          <button className="icon" onClick={onClose} title={t("common.close")}><Icon name="x" /></button>
        </header>
        {/* categories always on the left (as the user specified for all categorized modals) */}
        <div className="settings-layout">
          <nav className="settings-nav">
            {tabs.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => { setTab(t.id); setErr(null); }}><Icon name={t.icon} /> {t.label}</button>)}
          </nav>
          <div className="settings-body">
            {err && <p className="error">{err}</p>}
            {tab === "server" && <ServerTab api={api} server={server} directoryUrl={directoryUrl} run={run} />}
            {tab === "channels" && <ChannelsTab api={api} server={server} run={run} />}
            {tab === "roles" && <RolesTab api={api} server={server} run={run} />}
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

function ChannelsTab({ api, server, run }: { api: ServerApi; server: ServerState; run: RunFn }) {
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
      <h3>{t("admin.categories")}</h3>
      {server.categories.map((k) => (
        <div key={k.id} className="row">
          <input defaultValue={k.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== k.name) void run(() => api.updateCategory(k.id, { name: e.target.value.trim() })); }} />
          <button className="icon" title={t("admin.up")} onClick={() => move("category", k.id, -1)}><Icon name="chevron-up" /></button>
          <button className="icon" title={t("admin.down")} onClick={() => move("category", k.id, 1)}><Icon name="chevron-down" /></button>
          <button className="danger small" onClick={() => run(async () => { if (await askConfirm({ title: t("admin.deleteCategoryTitle", { name: k.name }), text: t("admin.deleteCategoryText"), confirmLabel: t("common.delete"), danger: true })) await api.deleteCategory(k.id); })}>{t("common.delete")}</button>
        </div>
      ))}
      <div className="row">
        <input value={catName} placeholder={t("admin.newCategory")} onChange={(e) => setCatName(e.target.value)} />
        <button disabled={!catName.trim()} onClick={() => run(() => api.createCategory(catName.trim()).then(() => setCatName("")))}>{t("admin.create")}</button>
      </div>

      <h3>{t("admin.channels")}</h3>
      {server.channels.map((c) => (
        <div key={c.id} className="row">
          <span className="channel-icon"><Icon name={c.kind === "text" ? "hash" : "volume-2"} /></span>
          <input defaultValue={c.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== c.name) void run(() => api.updateChannel(c.id, { name: e.target.value.trim() })); }} />
          {c.kind === "text" && <input defaultValue={c.topic ?? ""} placeholder={t("admin.topic")} onBlur={(e) => { if ((e.target.value.trim() || null) !== c.topic) void run(() => api.updateChannel(c.id, { topic: e.target.value.trim() || null })); }} />}
          {c.kind === "voice" && (
            <>
              <select value={c.audioBitrate} title={t("admin.bitrateHint")} onChange={(e) => run(() => api.updateChannel(c.id, { audioBitrate: Number(e.target.value) }))}>
                {AUDIO_BITRATES.map((b) => <option key={b} value={b}>{b} kbit/s</option>)}
              </select>
              <label className="check" title={t("admin.stereoHint")}>
                <input type="checkbox" checked={c.audioStereo} onChange={(e) => run(() => api.updateChannel(c.id, { audioStereo: e.target.checked }))} /> {t("admin.stereo")}
              </label>
            </>
          )}
          <select value={c.categoryId ?? ""} onChange={(e) => run(() => api.updateChannel(c.id, { categoryId: e.target.value || null }))}>
            <option value="">{t("admin.noCategory")}</option>
            {server.categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <button className="icon" title={t("admin.up")} onClick={() => move("channel", c.id, -1)}><Icon name="chevron-up" /></button>
          <button className="icon" title={t("admin.down")} onClick={() => move("channel", c.id, 1)}><Icon name="chevron-down" /></button>
          <button className="danger small" onClick={() => run(async () => { if (await askConfirm({ title: t("admin.deleteChannelTitle", { name: c.name }), text: c.kind === "text" ? t("admin.deleteTextChannelText") : t("admin.deleteVoiceChannelText"), confirmLabel: t("common.delete"), danger: true })) await api.deleteChannel(c.id); })}>{t("common.delete")}</button>
        </div>
      ))}
      <div className="row">
        <select value={chKind} onChange={(e) => setChKind(e.target.value as "text" | "voice")}><option value="text">{t("admin.kindText")}</option><option value="voice">{t("admin.kindVoice")}</option></select>
        <input value={chName} placeholder={t("admin.newChannel")} onChange={(e) => setChName(e.target.value)} />
        <select value={chCat} onChange={(e) => setChCat(e.target.value)}>
          <option value="">{t("admin.noCategory")}</option>
          {server.categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <button disabled={!chName.trim()} onClick={() => run(() => api.createChannel({ kind: chKind, name: chName.trim(), categoryId: chCat || null }).then(() => setChName("")))}>{t("admin.create")}</button>
      </div>
    </div>
  );
}

function RolesTab({ api, server, run }: { api: ServerApi; server: ServerState; run: RunFn }) {
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
        <ul>{sorted.map((r) => <li key={r.id}><button className={r.id === sel ? "active" : ""} style={r.color ? { color: r.color } : undefined} onClick={() => setSel(r.id)}>{r.name}{r.isDefault && <span className="muted"> {t("admin.defaultRole")}</span>}</button></li>)}</ul>
        <div className="row">
          <input value={newName} placeholder={t("admin.newRole")} onChange={(e) => setNewName(e.target.value)} />
          <button disabled={!newName.trim()} onClick={() => run(() => api.createRole({ name: newName.trim() }).then((r) => { setNewName(""); setSel(r.id); }))}>+</button>
        </div>
      </div>
      {role && (
        <div className="stack role-edit">
          <div className="row">
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} disabled={role.isDefault} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            {!role.isDefault && <label className="row">{t("admin.position")} <input type="number" value={position} min={1} onChange={(e) => setPosition(Number(e.target.value))} style={{ width: "5rem" }} /></label>}
          </div>
          <div className="perm-grid">
            {names.map((n) => (
              <label key={n} className="check">
                <input type="checkbox" checked={(perms & Permission[n]) !== 0} onChange={(e) => setPerms(e.target.checked ? perms | Permission[n] : perms & ~Permission[n])} />
                {t(`perm.${n}`)}
              </label>
            ))}
          </div>
          <p className="muted small">{t("admin.activePerms", { list: permissionNames(perms).join(", ") || t("admin.none") })}</p>
          <div className="row">
            <button onClick={() => run(() => api.updateRole(role.id, { name: name.trim() || role.name, color, permissions: perms, ...(role.isDefault ? {} : { position }) }))}>{t("common.save")}</button>
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
  const link = (code: string) => `${window.location.origin}/invite/${code}`;
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

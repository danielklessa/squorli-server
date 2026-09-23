import { Permission, hasPermission, type ServerState } from "@squorli/protocol";
import type { ChannelDialogTarget } from "./ChannelDialog";
import { useRef, useState, type DragEvent } from "react";
import type { ServerApi } from "./api";
import { reorderItems } from "./channelOrder";
import { askConfirm } from "./dialogs";
import { Icon } from "./Icon";
import { t } from "./i18n";

type SortKind = "channel" | "category";
type RunFn = (fn: () => Promise<unknown>) => Promise<void>;

/** Verwaltung > Kanäle: create, sort, delete and the AFK channel. Name, topic and every setting are the channel dialog's (the pencil, or a right-click in the sidebar; docs/features/channel-permissions.md). */
export function ChannelsTab({ api, server, run, onEdit }: { api: ServerApi; server: ServerState; run: RunFn; onEdit: (target: ChannelDialogTarget) => void }) {
  const [catName, setCatName] = useState("");
  const [chName, setChName] = useState("");
  const [chKind, setChKind] = useState<"text" | "voice">("text");
  const [chCat, setChCat] = useState("");
  const [drag, setDrag] = useState<{ kind: SortKind; id: string } | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [notice, setNotice] = useState("");
  const categories = [...server.categories].sort((a, b) => a.position - b.position);
  const channels = [...server.channels].sort((a, b) => a.position - b.position);

  const reorder = (kind: SortKind, id: string, targetId: string, after: boolean) => {
    if (busy.current) return;
    const list = kind === "channel" ? server.channels : server.categories;
    const ordered = reorderItems(list, id, targetId, after);
    const changes = ordered.filter((item) => list.find((old) => old.id === item.id)?.position !== item.position);
    if (!changes.length) return;
    busy.current = true;
    setSaving(true);
    setNotice("");
    void run(async () => {
      try {
        // Keep calls bound to the active server API; structure events deliver the saved order.
        for (const item of changes) {
          if (kind === "channel") await api.updateChannel(item.id, { position: item.position });
          else await api.updateCategory(item.id, { position: item.position });
        }
        setNotice(t("admin.orderSaved"));
      } finally { busy.current = false; setSaving(false); }
    });
  };
  const move = (kind: SortKind, id: string, dir: -1 | 1) => {
    const list = kind === "channel" ? channels : categories;
    const other = list[list.findIndex((item) => item.id === id) + dir];
    if (other) reorder(kind, id, other.id, dir === 1);
  };
  const dragHandle = (kind: SortKind, id: string, name: string) => (
    <button className="icon channel-drag" draggable={!saving} disabled={saving}
      title={t("admin.dragItem", { name })} aria-label={t("admin.dragItem", { name })}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        const row = e.currentTarget.closest<HTMLElement>(".channel-editor, .category-editor");
        if (row) e.dataTransfer.setDragImage(row, 20, 20);
        setDrag({ kind, id });
      }}
      onDragEnd={() => { setDrag(null); setDrop(null); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault(); move(kind, id, e.key === "ArrowUp" ? -1 : 1);
        }
      }}><Icon name="grip-vertical" /></button>
  );
  const dropProps = (kind: SortKind, id: string) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (saving || drag?.kind !== kind || drag.id === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      setDrop({ id, after: e.clientY > rect.top + rect.height / 2 });
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (drag?.kind === kind && drop?.id === id) reorder(kind, drag.id, id, drop.after);
      setDrag(null); setDrop(null);
    },
  });
  const rowClass = (base: string, id: string) => `${base}${drag?.id === id ? " is-dragging" : ""}${drop?.id === id ? (drop.after ? " drop-after" : " drop-before") : ""}`;
  const sortButtons = (kind: SortKind, id: string, name: string) => {
    const list = kind === "channel" ? channels : categories;
    const index = list.findIndex((item) => item.id === id);
    return <div className="channel-sort">
      <button className="icon" disabled={saving || index === 0} title={t("admin.up")} aria-label={`${name}: ${t("admin.up")}`} onClick={() => move(kind, id, -1)}><Icon name="chevron-up" /></button>
      <button className="icon" disabled={saving || index === list.length - 1} title={t("admin.down")} aria-label={`${name}: ${t("admin.down")}`} onClick={() => move(kind, id, 1)}><Icon name="chevron-down" /></button>
    </div>;
  };
  const categoryOptions = <><option value="">{t("admin.noCategory")}</option>{categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</>;

  return (
    <div className="channel-manager" aria-busy={saving}>
      <p className="muted small channel-help">{t("admin.sortHint")} {t("admin.channelFieldsHint")}</p>
      <p className="small channel-save-status" role="status">{saving ? t("admin.orderSaving") : notice}</p>
      <h3>{t("admin.categories")} <span className="channel-count">{categories.length}</span></h3>
      {categories.map((k) => (
        <div key={k.id} className={rowClass("category-editor", k.id)} {...dropProps("category", k.id)}>
          {dragHandle("category", k.id, k.name)}
          <span className="channel-title">{k.name}</span>
          <div className="channel-actions">
            <button className="icon" disabled={saving} title={t("admin.edit")} aria-label={`${k.name}: ${t("admin.edit")}`} onClick={() => onEdit({ kind: "category", id: k.id })}><Icon name="pencil" /></button>
            {sortButtons("category", k.id, k.name)}
            <button className="icon danger" disabled={saving} title={t("common.delete")} aria-label={`${k.name}: ${t("common.delete")}`} onClick={() => run(async () => { if (await askConfirm({ title: t("admin.deleteCategoryTitle", { name: k.name }), text: t("admin.deleteCategoryText"), confirmLabel: t("common.delete"), danger: true })) await api.deleteCategory(k.id); })}><Icon name="trash-2" /></button>
          </div>
        </div>
      ))}
      <form className="category-create" onSubmit={(e) => { e.preventDefault(); if (catName.trim()) void run(() => api.createCategory(catName.trim()).then(() => setCatName(""))); }}>
        <input aria-label={t("admin.newCategory")} maxLength={64} value={catName} placeholder={t("admin.newCategory")} onChange={(e) => setCatName(e.target.value)} />
        <button disabled={saving || !catName.trim()}>{t("admin.create")}</button>
      </form>

      <h3>{t("admin.channels")} <span className="channel-count">{channels.length}</span></h3>
      {channels.length === 0 && <p className="muted small">{t("admin.noChannels")}</p>}
      {channels.map((c) => (
        <div key={c.id} className={rowClass("channel-editor", c.id)} {...dropProps("channel", c.id)}>
          <div className="channel-editor-head">
            {dragHandle("channel", c.id, c.name)}
            <span className="channel-icon" title={t(c.kind === "text" ? "admin.kindText" : "admin.kindVoice")}><Icon name={c.kind === "text" ? "hash" : c.id === server.settings.afkChannelId ? "moon" : "volume-2"} /></span>
            <span className="channel-title">{c.name}{c.private && <Icon name="lock" title={t("sidebar.private")} />}{c.sticky && <Icon name="pin" title={t("sidebar.sticky")} />}</span>
            <div className="channel-actions">
              <button className="icon" disabled={saving} title={t("admin.edit")} aria-label={`${c.name}: ${t("admin.edit")}`} onClick={() => onEdit({ kind: "channel", id: c.id })}><Icon name="pencil" /></button>
              {sortButtons("channel", c.id, c.name)}
              <button className="icon danger" disabled={saving} title={t("common.delete")} aria-label={`${c.name}: ${t("common.delete")}`} onClick={() => run(async () => { if (await askConfirm({ title: t("admin.deleteChannelTitle", { name: c.name }), text: c.kind === "text" ? t("admin.deleteTextChannelText") : t("admin.deleteVoiceChannelText"), confirmLabel: t("common.delete"), danger: true })) await api.deleteChannel(c.id); })}><Icon name="trash-2" /></button>
            </div>
          </div>
        </div>
      ))}
      <h3>{t("admin.newChannel")}</h3>
      <form className="channel-create" onSubmit={(e) => { e.preventDefault(); if (chName.trim()) void run(() => api.createChannel({ kind: chKind, name: chName.trim(), categoryId: chCat || null }).then(() => setChName(""))); }}>
        <input aria-label={t("admin.channelName")} maxLength={64} value={chName} placeholder={t("admin.newChannel")} onChange={(e) => setChName(e.target.value)} />
        <select aria-label={t("admin.channelKind")} value={chKind} onChange={(e) => setChKind(e.target.value as "text" | "voice")}><option value="text">{t("admin.kindText")}</option><option value="voice">{t("admin.kindVoice")}</option></select>
        <select aria-label={t("admin.categories")} value={chCat} onChange={(e) => setChCat(e.target.value)}>{categoryOptions}</select>
        <button disabled={saving || !chName.trim()}>{t("admin.create")}</button>
      </form>

      {/* AFK channel: a server setting (MANAGE_SERVER), kept here because it is about a channel. Hidden on servers from before it. */}
      {server.settings.afkChannelId !== undefined && hasPermission(server.myPermissions, Permission.MANAGE_SERVER) && (
        <>
          <h3>{t("admin.afk")}</h3>
          <p className="muted small">{t("admin.afkHint")}</p>
          {channels.some((c) => c.kind === "voice") ? (
            <div className="channel-editor-fields">
              <label>{t("admin.afkChannel")}<select value={server.settings.afkChannelId ?? ""} disabled={saving} onChange={(e) => run(() => api.updateSettings({ afkChannelId: e.target.value || null }))}>
                <option value="">{t("admin.afkNone")}</option>
                {channels.filter((c) => c.kind === "voice").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            </div>
          ) : <p className="muted small">{t("admin.afkNoVoice")}</p>}
        </>
      )}
    </div>
  );
}

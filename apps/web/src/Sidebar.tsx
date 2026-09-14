import { Permission, hasPermission, type Channel, type ServerState, type VoiceMember } from "@squorli/protocol";
import { useState } from "react";
import type { ServerApi } from "./api";
import type { VoiceState } from "./voice/voiceClient";
import { Icon } from "./Icon";

type Props = {
  server: ServerState;
  api: ServerApi;
  /** Kanal, der im Hauptbereich angezeigt wird (Textkanal oder die Buehne des Sprachkanals): nur er ist hinterlegt. */
  currentChannelId: string | null;
  voice: Record<string, VoiceMember[]>;
  /** Eigene Sprachverbindung, wenn sie zu diesem Server gehoert; sonst null (Multi-Server-Client). */
  voiceState: VoiceState | null;
  unread: Record<string, boolean>;
  connection: string;
  onSelect: (channelId: string) => void;
  onJoinVoice: (channelId: string) => void;
  onOpenAdmin: () => void;
  myUserId: string;
};

export function Sidebar({ server, api, currentChannelId, voice, voiceState, unread, connection, onSelect, onJoinVoice, onOpenAdmin, myUserId }: Props) {
  // Drag & Drop: Sprachteilnehmer auf einen anderen Sprachkanal ziehen (sich selbst immer, andere mit MODERATE_VOICE).
  const canModerate = hasPermission(server.myPermissions, Permission.MODERATE_VOICE);
  const [dragging, setDragging] = useState<{ userId: string; from: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragErr, setDragErr] = useState<string | null>(null);
  const isOwner = (userId: string) => server.members.find((m) => m.userId === userId)?.isOwner ?? false;
  const canDrag = (userId: string) => userId === myUserId || (canModerate && !isOwner(userId));
  const onDrop = (channelId: string) => {
    const d = dragging;
    setDragging(null); setDropTarget(null);
    if (!d || d.from === channelId) return;
    if (d.userId === myUserId) { onJoinVoice(channelId); return; }
    setDragErr(null);
    api.moveMember(d.userId, channelId).catch((e: unknown) => setDragErr(e instanceof Error ? e.message : String(e)));
  };
  const canAdmin = hasPermission(server.myPermissions, Permission.MANAGE_CHANNELS) || hasPermission(server.myPermissions, Permission.MANAGE_ROLES)
    || hasPermission(server.myPermissions, Permission.MANAGE_SERVER) || hasPermission(server.myPermissions, Permission.BAN_MEMBERS)
    || hasPermission(server.myPermissions, Permission.KICK_MEMBERS) || hasPermission(server.myPermissions, Permission.CREATE_INVITES);
  const groups: { id: string | null; name: string; channels: Channel[] }[] = [
    { id: null, name: "", channels: server.channels.filter((c) => c.categoryId === null || !server.categories.some((k) => k.id === c.categoryId)) },
    ...server.categories.map((k) => ({ id: k.id, name: k.name, channels: server.channels.filter((c) => c.categoryId === k.id) })),
  ].filter((g) => g.channels.length > 0 || g.id !== null);

  const renderChannel = (c: Channel) => {
    const members = voice[c.id] ?? [];
    const active = c.id === currentChannelId;
    const joined = c.kind === "voice" && voiceState?.channelId === c.id;
    const droppable = c.kind === "voice" && dragging !== null && dragging.from !== c.id;
    return (
      <li key={c.id} className={`channel ${active ? "active" : ""} ${joined ? "joined" : ""} ${unread[c.id] ? "unread" : ""} ${droppable ? "droppable" : ""} ${dropTarget === c.id ? "drop-target" : ""}`}
        onDragOver={(e) => { if (droppable) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropTarget !== c.id) setDropTarget(c.id); } }}
        onDragLeave={(e) => { if (dropTarget === c.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null); }}
        onDrop={(e) => { if (droppable) { e.preventDefault(); onDrop(c.id); } }}>
        <button className="channel-btn" onClick={() => (c.kind === "text" ? onSelect(c.id) : onJoinVoice(c.id))} title={c.topic ?? undefined}>
          <span className="channel-icon"><Icon name={c.kind === "text" ? "hash" : "volume-2"} /></span>
          <span className="channel-name">{c.name}</span>
          {c.kind === "voice" && members.length > 0 && <span className="count">{members.length}</span>}
        </button>
        {c.kind === "voice" && members.length > 0 && (
          <ul className="voice-members">
            {members.map((m) => {
              const p = voiceState?.channelId === c.id ? voiceState.participants.find((x) => x.identity === m.userId) : undefined;
              const draggable = canDrag(m.userId);
              return <li key={m.userId} className={`${p?.speaking ? "speaking" : ""} ${draggable ? "draggable" : ""} ${dragging?.userId === m.userId ? "dragging" : ""}`}
                draggable={draggable} title={draggable ? "In einen anderen Sprachkanal ziehen" : undefined}
                onDragStart={(e) => { if (!draggable) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", m.userId); setDragging({ userId: m.userId, from: c.id }); }}
                onDragEnd={() => { setDragging(null); setDropTarget(null); }}><span className="dot" /><span className="member-name">{m.displayName}</span>{p?.micMuted && <Icon name="mic-off" className="muted" title="Mikrofon stumm" />}{p?.deafened && <Icon name="headphone-off" className="muted" title="Ton aus" />}{p?.cameraOn && <Icon name="video" title="Kamera an" />}{p?.screenOn && <Icon name="screen-share" title="teilt Bildschirm" />}</li>;
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav className="sidebar">
      <header className="server-head">
        <img className={`brand-mark ${server.settings.iconUrl ? "server-icon" : ""}`} src={server.settings.iconUrl ? api.abs(server.settings.iconUrl) : "/brand/squorli-icon-small.svg"} alt="" width="22" height="22" />
        <strong>{server.settings.name}</strong>
        {connection !== "connected" && <span className="muted"> · {connection}</span>}
        {canAdmin && <button className="icon" title="Verwaltung" onClick={onOpenAdmin}><Icon name="settings" /></button>}
      </header>
      {dragErr && <p className="error small" style={{ padding: "0 0.9rem" }}>{dragErr}</p>}
      <div className="channel-list">
        {groups.map((g) => (
          <section key={g.id ?? "none"}>
            {g.id !== null && <h3>{g.name}</h3>}
            <ul>{g.channels.map(renderChannel)}</ul>
          </section>
        ))}
      </div>
    </nav>
  );
}

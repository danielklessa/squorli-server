import { Avatar } from "./Avatar";
import { Permission, hasPermission, type Channel, type ServerState, type VoiceMember } from "@squorli/protocol";
import { useState } from "react";
import type { ServerApi } from "./api";
import { ContextMenu, type MenuAnchor } from "./ContextMenu";
import { UserVolumeControl } from "./UserVolumeControl";
import type { VoiceClient, VoiceState } from "./voice/voiceClient";
import { Icon } from "./Icon";
import { t, tOr } from "./i18n";

type Props = {
  server: ServerState;
  api: ServerApi;
  /** The channel shown in the main area (text channel or the voice channel's stage): only it is highlighted. */
  currentChannelId: string | null;
  voice: Record<string, VoiceMember[]>;
  /** Your own voice connection if it belongs to this server; otherwise null (multi-server client). */
  voiceState: VoiceState | null;
  /** For the per-person playback volume in the voice members' context menu. */
  client: VoiceClient;
  unread: Record<string, boolean>;
  /** Unseen messages that mention me, per channel. */
  mentions: Record<string, number>;
  /** Channels I have muted; `canMute` = the server keeps mutes (offers the context menu). */
  muted: Record<string, boolean>;
  /** Web radio: what a channel's station is playing right now (tooltip of the radio mark). */
  radioTitles: Record<string, string>;
  canMute: boolean;
  onMuteChannel: (channelId: string, muted: boolean) => void;
  connection: string;
  onSelect: (channelId: string) => void;
  onJoinVoice: (channelId: string) => void;
  onOpenAdmin: () => void;
  myUserId: string;
};

export function Sidebar({ server, api, currentChannelId, voice, voiceState, client, unread, mentions, muted, radioTitles, canMute, onMuteChannel, connection, onSelect, onJoinVoice, onOpenAdmin, myUserId }: Props) {
  // Right-click on a voice member: how loud to play them back (not for yourself).
  const [menu, setMenu] = useState<({ userId: string } & MenuAnchor) | null>(null);
  // Right-click on a text channel: mute it for myself.
  const [channelMenu, setChannelMenu] = useState<({ channelId: string } & MenuAnchor) | null>(null);
  const menuChannel = channelMenu ? server.channels.find((c) => c.id === channelMenu.channelId) ?? null : null;
  const menuMember = menu ? server.members.find((m) => m.userId === menu.userId) ?? null : null;
  // Voice rows carry only id and name (VoiceMember); the avatar comes from the member list.
  const avatarOf = new Map(server.members.map((m) => [m.userId, m.avatarUrl]));
  // Drag & drop: drag a voice participant onto another voice channel (yourself always, others with MODERATE_VOICE).
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

  const afkOf = new Set(server.members.filter((m) => m.afk).map((m) => m.userId));
  const renderChannel = (c: Channel) => {
    const members = voice[c.id] ?? [];
    const isAfkChannel = c.kind === "voice" && server.settings.afkChannelId === c.id;
    const active = c.id === currentChannelId;
    const joined = c.kind === "voice" && voiceState?.channelId === c.id;
    const droppable = c.kind === "voice" && dragging !== null && dragging.from !== c.id;
    return (
      <li key={c.id} className={`channel ${active ? "active" : ""} ${joined ? "joined" : ""} ${unread[c.id] && !muted[c.id] ? "unread" : ""} ${(mentions[c.id] ?? 0) > 0 ? "mentioned" : ""} ${muted[c.id] ? "muted-channel" : ""} ${droppable ? "droppable" : ""} ${dropTarget === c.id ? "drop-target" : ""}`}
        onDragOver={(e) => { if (droppable) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropTarget !== c.id) setDropTarget(c.id); } }}
        onDragLeave={(e) => { if (dropTarget === c.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null); }}
        onDrop={(e) => { if (droppable) { e.preventDefault(); onDrop(c.id); } }}>
        <button className="channel-btn" aria-current={active ? "page" : undefined} onClick={() => (c.kind === "text" ? onSelect(c.id) : onJoinVoice(c.id))} title={isAfkChannel ? t("sidebar.afkChannel") : c.topic ?? undefined}
          onContextMenu={(e) => { if (c.kind !== "text" || !canMute) return; e.preventDefault(); setChannelMenu({ channelId: c.id, trigger: e.currentTarget, x: e.clientX, y: e.clientY }); }}>
          <span className="channel-icon"><Icon name={c.kind === "text" ? "hash" : isAfkChannel ? "moon" : "volume-2"} /></span>
          <span className="channel-name">{c.name}</span>
          {c.radio && <span className="channel-radio" title={radioTitles[c.id] ? t("radio.inChannelPlaying", { name: c.radio.name, title: radioTitles[c.id] ?? "" }) : t("radio.inChannel", { name: c.radio.name })}><Icon name="radio" /></span>}
          {c.kind === "voice" && members.length > 0 && <span className="count">{members.length}</span>}
          {muted[c.id] && <span className="channel-muted" title={t("sidebar.muted")}><Icon name="bell-off" /></span>}
          {(mentions[c.id] ?? 0) > 0 && <span className="mention-badge" title={t("sidebar.mentions", { n: mentions[c.id] ?? 0 })}>{mentions[c.id]}</span>}
        </button>
        {c.kind === "voice" && members.length > 0 && (
          <ul className="voice-members">
            {members.map((m) => {
              const p = voiceState?.channelId === c.id ? voiceState.participants.find((x) => x.identity === m.userId) : undefined;
              const draggable = canDrag(m.userId);
              return <li key={m.userId} className={`${p?.speaking ? "speaking" : ""} ${draggable ? "draggable" : ""} ${dragging?.userId === m.userId ? "dragging" : ""} ${menu?.userId === m.userId ? "menu-open" : ""}`}
                draggable={draggable} title={draggable ? t("sidebar.dragHint") : undefined}
                onContextMenu={(e) => { if (m.userId === myUserId) return; e.preventDefault(); setMenu({ userId: m.userId, trigger: e.currentTarget, x: e.clientX, y: e.clientY }); }}
                onDragStart={(e) => { if (!draggable) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", m.userId); setDragging({ userId: m.userId, from: c.id }); }}
                onDragEnd={() => { setDragging(null); setDropTarget(null); }}><Avatar name={m.displayName} src={avatarOf.get(m.userId)} size="small" /><span className="member-name">{m.displayName}</span>{afkOf.has(m.userId) && <Icon name="moon" className="afk" title={t("members.afk")} />}{p?.micMuted && <Icon name="mic-off" className="muted" title={t("voice.micMuted")} />}{p?.deafened && <Icon name="headphone-off" className="muted" title={t("voice.deafened")} />}{p?.cameraOn && <Icon name="video" title={t("voice.cameraOn")} />}{p?.screenOn && <Icon name="screen-share" title={t("voice.sharingScreen")} />}</li>;
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
        {connection !== "connected" && <span className="muted"> · {tOr(`conn.${connection}`, connection)}</span>}
        {canAdmin && <button className="icon" title={t("sidebar.admin")} onClick={onOpenAdmin}><Icon name="settings" /></button>}
      </header>
      {channelMenu && menuChannel && (
        <ContextMenu anchor={channelMenu} label={menuChannel.name} onClose={() => setChannelMenu(null)}>
          <button role="menuitem" onClick={() => { onMuteChannel(menuChannel.id, !muted[menuChannel.id]); setChannelMenu(null); }}>
            <Icon name={muted[menuChannel.id] ? "bell" : "bell-off"} /> {muted[menuChannel.id] ? t("sidebar.unmuteChannel") : t("sidebar.muteChannel")}
          </button>
        </ContextMenu>
      )}
      {menu && menuMember && (
        <ContextMenu anchor={menu} label={menuMember.displayName} onClose={() => setMenu(null)}>
          <div className="context-identity" role="presentation"><Avatar name={menuMember.displayName} src={menuMember.avatarUrl} online={menuMember.online} /><strong>{menuMember.displayName}</strong></div>
          <UserVolumeControl client={client} publicKey={menuMember.publicKey} />
        </ContextMenu>
      )}
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

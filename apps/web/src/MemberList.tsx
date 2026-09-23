import { Avatar } from "./Avatar";
import { Permission, hasPermission, type Channel, type Friend, type Member, type Role, type VoiceMember } from "@squorli/protocol";
import { useState, type MouseEvent, type ReactNode } from "react";
import { ContextMenu, ContextSubmenu, type MenuAnchor } from "./ContextMenu";
import type { ServerApi } from "./api";
import { moveErrorText } from "./apiErrorText";
import { askConfirm, askInput } from "./dialogs";
import { Icon } from "./Icon";
import { GameLine } from "./GameLine";
import { UserVolumeControl } from "./UserVolumeControl";
import type { VoiceClient } from "./voice/voiceClient";
import { t } from "./i18n";
import { assignableRoles, canSetRolesOf, topRoleOf } from "./memberRank";
import { voteKickChannel } from "./voteKick";

type Props = {
  api: ServerApi;
  /** ownerId = first owner (cannot be revoked); further owners carry isOwner. */
  members: Member[]; roles: Role[]; myUserId: string; myPermissions: number; ownerId: string | null;
  /** Voice channel presence (channelId -> members) and channels for moderation (moving). */
  voice: Record<string, VoiceMember[]>; channels: Channel[];
  /** M7: friends via the directory; null = no directory socket (then no entries in the menu). */
  friends: { stateOf: (publicKey: string) => Friend["state"] | null; onRequest: (publicKey: string) => void; onMessage: (publicKey: string) => void } | null;
  /** For the per-person playback volume in the menu. */
  client: VoiceClient;
  /** Phone: the list is a panel slid in from the right; a header with this close button sits on top. null = the desktop column. */
  onClose?: (() => void) | null;
  /** Vote kick (docs/features/votekick.md): per voice channel whether the server would take a vote right now. */
  voteKickAllowed: Record<string, boolean>;
  onVoteKick: (userId: string, channelId: string) => void;
  /** The running vote's box, at the top of this list (user's wish, 23 September 2026); null = none right now. */
  voteKickBox: ReactNode;
};

/** Right column: owners at the very top, then members grouped by highest role, online first. Context actions depending on permissions. */
export function MemberList({ api, members, roles, myUserId, myPermissions, ownerId, voice, channels, friends, client, onClose = null, voteKickAllowed, onVoteKick, voteKickBox }: Props) {
  const [open, setOpen] = useState<({ userId: string } & MenuAnchor) | null>(null);
  const openMenu = (event: MouseEvent<HTMLButtonElement>, userId: string) => {
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setOpen({ userId, trigger: event.currentTarget, x: event.type === "contextmenu" && event.clientX ? event.clientX : box.left, y: event.type === "contextmenu" && event.clientY ? event.clientY : box.bottom });
  };
  const [err, setErr] = useState<string | null>(null);
  const topRole = (m: Member) => topRoleOf(m, roles);
  const groups = new Map<string, { name: string; color: string | null; position: number; members: Member[] }>();
  for (const m of members) {
    const r = topRole(m);
    const key = m.isOwner ? "_owner" : m.online ? (r?.id ?? "_online") : "_offline";
    const g = groups.get(key) ?? (m.isOwner
      ? { name: t("members.owners"), color: null, position: Number.MAX_SAFE_INTEGER, members: [] }
      : { name: m.online ? (r?.name ?? t("members.online")) : t("members.offline"), color: m.online ? (r?.color ?? null) : null, position: m.online ? (r?.position ?? 0) : -1, members: [] });
    g.members.push(m);
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort((a, b) => b.position - a.position);
  const canKick = hasPermission(myPermissions, Permission.KICK_MEMBERS);
  const canBan = hasPermission(myPermissions, Permission.BAN_MEMBERS);
  const canRoles = hasPermission(myPermissions, Permission.MANAGE_ROLES);
  const canModerate = hasPermission(myPermissions, Permission.MODERATE_VOICE);
  // Moving got its own right (23 September 2026, docs/features/channel-permissions.md); an overwrite may give it in one channel only, the server decides.
  const canMove = hasPermission(myPermissions, Permission.MOVE_MEMBERS);
  const meMember = members.find((m) => m.userId === myUserId) ?? null;
  const iAmOwner = meMember?.isOwner ?? false;
  // Only what the server would accept is offered (memberRank.ts): roles below my own, and members I may act on.
  const myRoles = meMember && canRoles ? assignableRoles(meMember, roles) : [];
  const voiceChannels = channels.filter((c) => c.kind === "voice");
  const voiceChannelOf = (userId: string) => Object.keys(voice).find((cid) => (voice[cid] ?? []).some((m) => m.userId === userId)) ?? null;

  async function run(fn: () => Promise<unknown>, explain: (e: unknown) => string = String) {
    setErr(null);
    setOpen(null);
    try { await fn(); } catch (e) { setErr(explain(e)); }
  }

  return (
    <aside className="members-col" aria-label={t("members.title")}>
      {onClose && <header className="members-head"><strong>{t("members.title")} · {members.length}</strong><button className="icon" title={t("members.close")} aria-label={t("members.close")} onClick={onClose}><Icon name="x" /></button></header>}
      {voteKickBox}
      {err && <p className="error small">{err}</p>}
      {ordered.map((g) => (
        <section key={g.name + g.position}>
          <h4 style={g.color ? { color: g.color } : undefined}>{g.name} · {g.members.length}</h4>
          <ul>
            {g.members.map((m) => {
              const r = topRole(m);
              const isMe = m.userId === myUserId;
              return (
                <li key={m.userId} className={`member ${m.online ? "" : "offline"}`}>
                  <button className="member-btn" aria-haspopup="menu" aria-expanded={open?.userId === m.userId} onContextMenu={(e) => openMenu(e, m.userId)} onClick={(e) => openMenu(e, m.userId)}>
                    <Avatar name={m.displayName} src={m.avatarUrl} online={m.online} afk={m.afk} />
                    <span className="member-identity"><span style={r?.color ? { color: r.color } : undefined}>{m.displayName}</span><GameLine game={m.online ? m.game : null} fallback={(m.handle || isMe) && <small>{m.handle && `@${m.handle}`}{m.handle && isMe && " "}{isMe && t("members.you")}</small>} /></span>
                    {m.online && m.afk && <Icon name="moon" className="afk" title={t("members.afk")} />}
                    {m.isOwner && <Icon name="crown" className="owner" title={t("members.owner")} />}
                    {m.streamBlocked && <Icon name="video-off" className="muted" title={t("members.streamBlocked")} />}
                  </button>
                  {open?.userId === m.userId && (
                    <ContextMenu anchor={open} label={m.displayName} onClose={() => setOpen(null)}>
                      <div className="context-identity" role="presentation"><Avatar name={m.displayName} src={m.avatarUrl} online={m.online} afk={m.afk} /><div><strong>{m.displayName}</strong><GameLine game={m.online ? m.game : null} /></div></div>
                      <div className="muted small">{m.handle && <><strong>@{m.handle}</strong> · </>}{m.publicKey.slice(0, 16)}…</div>
                      {friends && !isMe && (() => {
                        // M7: add friend / write a message. Without a handle the member has no directory account, so friendship is not possible.
                        const st = friends.stateOf(m.publicKey);
                        return (
                          <div className="row friend-row">
                            {st === "accepted" && <button role="menuitem" className="secondary small" onClick={() => { setOpen(null); friends.onMessage(m.publicKey); }}><Icon name="message-circle" /> {t("members.writeMessage")}</button>}
                            {st === "pending_out" && <span className="muted small">{t("members.requestSent")}</span>}
                            {st === "pending_in" && <button role="menuitem" className="secondary small" onClick={() => { setOpen(null); friends.onMessage(m.publicKey); }}>{t("members.wantsFriend")}</button>}
                            {st === "blocked" && <span className="muted small">{t("members.blocked")}</span>}
                            {st === null && (m.handle
                              ? <button role="menuitem" className="secondary small" onClick={() => { setOpen(null); friends.onRequest(m.publicKey); }}><Icon name="user-plus" /> {t("home.addFriend")}</button>
                              : <span className="muted small" title={t("home.noAccountHint")}>{t("members.noDirectoryAccount")}</span>)}
                          </div>
                        );
                      })()}
                      {!isMe && <UserVolumeControl client={client} publicKey={m.publicKey} />}
                      {meMember && !isMe && myRoles.length > 0 && canSetRolesOf(meMember, m, roles, ownerId) && (
                        <ContextSubmenu label={t("members.roles")}>
                          {myRoles.map((x) => (
                            <button key={x.id} role="menuitemcheckbox" aria-checked={m.roleIds.includes(x.id)} onClick={() => run(() => api.setMemberRoles(m.userId, m.roleIds.includes(x.id) ? m.roleIds.filter((id) => id !== x.id) : [...m.roleIds, x.id]))}>
                              <span style={x.color ? { color: x.color } : undefined}>{x.name}</span>
                              {m.roleIds.includes(x.id) && <Icon name="check" />}
                            </button>
                          ))}
                        </ContextSubmenu>
                      )}
                      {iAmOwner && !isMe && (!m.isOwner || m.userId !== ownerId) && (
                        <div className="row">
                          <button role="menuitem" className="secondary small" onClick={() => run(async () => {
                            const ok = await askConfirm(m.isOwner
                              ? { title: t("members.revokeOwnerTitle", { name: m.displayName }), text: t("members.revokeOwnerText"), confirmLabel: t("members.revoke"), danger: true }
                              : { title: t("members.makeOwnerTitle", { name: m.displayName }), text: t("members.makeOwnerText"), confirmLabel: t("members.appoint") });
                            if (ok) await api.setOwner(m.userId, !m.isOwner);
                          })}>{m.isOwner ? t("members.revokeOwner") : t("members.makeOwner")}</button>
                        </div>
                      )}
                      {!isMe && (canModerate || canMove) && !m.isOwner && (() => {
                        const inVoice = voiceChannelOf(m.userId);
                        return (
                          <div className="stack mod-voice">
                            <span className="muted small">{t("members.voiceChannel")}: {inVoice ? channels.find((c) => c.id === inVoice)?.name ?? "?" : t("members.notConnected")}</span>
                            {inVoice && canMove && (
                              <ContextSubmenu label={t("members.moveTo")}>
                                {voiceChannels.filter((c) => c.id !== inVoice).map((c) => <button role="menuitem" key={c.id} onClick={() => run(() => api.moveMember(m.userId, c.id), moveErrorText)}><Icon name="volume-2" /> {c.name}</button>)}
                                <button role="menuitem" className="danger" onClick={() => run(() => api.moveMember(m.userId, null), moveErrorText)}>{t("members.removeFromVoice")}</button>
                              </ContextSubmenu>
                            )}
                            {inVoice && canModerate && <button role="menuitem" className="secondary small" onClick={() => run(() => api.stopMemberStreams(m.userId, { camera: true, screen: true }))}>{t("members.stopStreams")}</button>}
                            {canModerate && <button role="menuitem" className={`${m.streamBlocked ? "" : "danger"} small`} onClick={() => run(() => api.setStreamBlocked(m.userId, !m.streamBlocked))}>
                              {m.streamBlocked ? t("members.allowStreams") : t("members.blockStreams")}
                            </button>}
                          </div>
                        );
                      })()}
                      {(() => {
                        // Vote kick: only where we both sit and the server allows it right now (it checks again).
                        const channelId = voteKickChannel({ voice, voteKickAllowed, myUserId, targetId: m.userId });
                        return channelId && (
                          <div className="row">
                            <button role="menuitem" className="secondary small" onClick={() => { setOpen(null); onVoteKick(m.userId, channelId); }}><Icon name="gavel" /> {t("votekick.menu")}</button>
                          </div>
                        );
                      })()}
                      {!isMe && !m.isOwner && (canKick || canBan) && (
                        <div className="row">
                          {canKick && <button role="menuitem" className="secondary small" onClick={() => run(async () => { if (await askConfirm({ title: t("members.kickTitle", { name: m.displayName }), text: t("members.kickText"), confirmLabel: t("members.kick"), danger: true })) await api.kickMember(m.userId); })}>{t("members.kick")}</button>}
                          {canBan && <button role="menuitem" className="danger small" onClick={() => run(async () => { const reason = await askInput({ title: t("members.banTitle", { name: m.displayName }), text: t("members.banText"), label: t("members.reason"), placeholder: t("members.reasonPlaceholder"), optional: true, confirmLabel: t("members.ban"), danger: true }); if (reason !== null) await api.banMember(m.userId, reason || null); })}>{t("members.ban")}</button>}
                        </div>
                      )}
                    </ContextMenu>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}

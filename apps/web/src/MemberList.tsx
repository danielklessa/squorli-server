import { Permission, hasPermission, type Channel, type Friend, type Member, type Role, type VoiceMember } from "@squorli/protocol";
import { useState } from "react";
import type { ServerApi } from "./api";
import { askConfirm, askInput } from "./dialogs";
import { Icon } from "./Icon";
import { t } from "./i18n";

type Props = {
  api: ServerApi;
  /** ownerId = first owner (cannot be revoked); further owners carry isOwner. */
  members: Member[]; roles: Role[]; myUserId: string; myPermissions: number; ownerId: string | null;
  /** Voice channel presence (channelId -> members) and channels for moderation (moving). */
  voice: Record<string, VoiceMember[]>; channels: Channel[];
  /** M7: friends via the directory; null = no directory socket (then no entries in the menu). */
  friends: { stateOf: (publicKey: string) => Friend["state"] | null; onRequest: (publicKey: string) => void; onMessage: (publicKey: string) => void } | null;
};

/** Right column: owners at the very top, then members grouped by highest role, online first. Context actions depending on permissions. */
export function MemberList({ api, members, roles, myUserId, myPermissions, ownerId, voice, channels, friends }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const topRole = (m: Member) => m.roleIds.map((id) => roleById.get(id)).filter((r): r is Role => !!r).sort((a, b) => b.position - a.position)[0];
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
  const iAmOwner = members.find((m) => m.userId === myUserId)?.isOwner ?? false;
  const voiceChannels = channels.filter((c) => c.kind === "voice");
  const voiceChannelOf = (userId: string) => Object.keys(voice).find((cid) => (voice[cid] ?? []).some((m) => m.userId === userId)) ?? null;

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); setOpen(null); } catch (e) { setErr(String(e)); }
  }

  return (
    <aside className="members-col">
      {err && <p className="error small">{err}</p>}
      {ordered.map((g) => (
        <section key={g.name + g.position}>
          <h4 style={g.color ? { color: g.color } : undefined}>{g.name} · {g.members.length}</h4>
          <ul>
            {g.members.map((m) => {
              const r = topRole(m);
              const isMe = m.userId === myUserId;
              return (
                <li key={m.userId} className={`member ${m.online ? "" : "offline"}`} onContextMenu={(e) => { e.preventDefault(); setOpen(open === m.userId ? null : m.userId); }}>
                  <button className="member-btn" onClick={() => setOpen(open === m.userId ? null : m.userId)}>
                    <span className={`presence ${m.online ? "on" : ""}`} />
                    <span style={r?.color ? { color: r.color } : undefined}>{m.displayName}</span>
                    {m.isOwner && <Icon name="crown" className="owner" title={t("members.owner")} />}
                    {m.streamBlocked && <Icon name="video-off" className="muted" title={t("members.streamBlocked")} />}
                    {isMe && <span className="muted"> {t("members.you")}</span>}
                  </button>
                  {open === m.userId && (
                    <div className="member-menu">
                      <div className="muted small">{m.handle && <><strong>@{m.handle}</strong> · </>}{m.publicKey.slice(0, 16)}…</div>
                      {friends && !isMe && (() => {
                        // M7: add friend / write a message. Without a handle the member has no directory account, so friendship is not possible.
                        const st = friends.stateOf(m.publicKey);
                        return (
                          <div className="row friend-row">
                            {st === "accepted" && <button className="secondary small" onClick={() => { setOpen(null); friends.onMessage(m.publicKey); }}><Icon name="message-circle" /> {t("members.writeMessage")}</button>}
                            {st === "pending_out" && <span className="muted small">{t("members.requestSent")}</span>}
                            {st === "pending_in" && <button className="secondary small" onClick={() => { setOpen(null); friends.onMessage(m.publicKey); }}>{t("members.wantsFriend")}</button>}
                            {st === "blocked" && <span className="muted small">{t("members.blocked")}</span>}
                            {st === null && (m.handle
                              ? <button className="secondary small" onClick={() => { setOpen(null); friends.onRequest(m.publicKey); }}><Icon name="user-plus" /> {t("home.addFriend")}</button>
                              : <span className="muted small" title={t("home.noAccountHint")}>{t("members.noDirectoryAccount")}</span>)}
                          </div>
                        );
                      })()}
                      {canRoles && !isMe && (
                        <div className="stack">
                          {roles.filter((x) => !x.isDefault).map((x) => (
                            <label key={x.id} className="check">
                              <input type="checkbox" checked={m.roleIds.includes(x.id)}
                                onChange={(e) => run(() => api.setMemberRoles(m.userId, e.target.checked ? [...m.roleIds, x.id] : m.roleIds.filter((id) => id !== x.id)))} />
                              <span style={x.color ? { color: x.color } : undefined}>{x.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {iAmOwner && !isMe && (!m.isOwner || m.userId !== ownerId) && (
                        <div className="row">
                          <button className="secondary small" onClick={() => run(async () => {
                            const ok = await askConfirm(m.isOwner
                              ? { title: t("members.revokeOwnerTitle", { name: m.displayName }), text: t("members.revokeOwnerText"), confirmLabel: t("members.revoke"), danger: true }
                              : { title: t("members.makeOwnerTitle", { name: m.displayName }), text: t("members.makeOwnerText"), confirmLabel: t("members.appoint") });
                            if (ok) await api.setOwner(m.userId, !m.isOwner);
                          })}>{m.isOwner ? t("members.revokeOwner") : t("members.makeOwner")}</button>
                        </div>
                      )}
                      {!isMe && canModerate && !m.isOwner && (() => {
                        const inVoice = voiceChannelOf(m.userId);
                        return (
                          <div className="stack mod-voice">
                            <span className="muted small">{t("members.voiceChannel")}: {inVoice ? channels.find((c) => c.id === inVoice)?.name ?? "?" : t("members.notConnected")}</span>
                            {inVoice && (
                              <>
                                <select value="" onChange={(e) => { const to = e.target.value; if (to) void run(() => api.moveMember(m.userId, to === "__out" ? null : to)); }}>
                                  <option value="">{t("members.moveTo")}</option>
                                  {voiceChannels.filter((c) => c.id !== inVoice).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  <option value="__out">{t("members.removeFromVoice")}</option>
                                </select>
                                <button className="secondary small" onClick={() => run(() => api.stopMemberStreams(m.userId, { camera: true, screen: true }))}>{t("members.stopStreams")}</button>
                              </>
                            )}
                            <button className={`${m.streamBlocked ? "" : "danger"} small`} onClick={() => run(() => api.setStreamBlocked(m.userId, !m.streamBlocked))}>
                              {m.streamBlocked ? t("members.allowStreams") : t("members.blockStreams")}
                            </button>
                          </div>
                        );
                      })()}
                      {!isMe && !m.isOwner && (canKick || canBan) && (
                        <div className="row">
                          {canKick && <button className="secondary small" onClick={() => run(async () => { if (await askConfirm({ title: t("members.kickTitle", { name: m.displayName }), text: t("members.kickText"), confirmLabel: t("members.kick"), danger: true })) await api.kickMember(m.userId); })}>{t("members.kick")}</button>}
                          {canBan && <button className="danger small" onClick={() => run(async () => { const reason = await askInput({ title: t("members.banTitle", { name: m.displayName }), text: t("members.banText"), label: t("members.reason"), placeholder: t("members.reasonPlaceholder"), optional: true, confirmLabel: t("members.ban"), danger: true }); if (reason !== null) await api.banMember(m.userId, reason || null); })}>{t("members.ban")}</button>}
                        </div>
                      )}
                    </div>
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

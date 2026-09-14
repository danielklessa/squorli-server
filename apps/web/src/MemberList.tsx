import { Permission, hasPermission, type Channel, type Friend, type Member, type Role, type VoiceMember } from "@squorli/protocol";
import { useState } from "react";
import type { ServerApi } from "./api";
import { askConfirm, askInput } from "./dialogs";
import { Icon } from "./Icon";

type Props = {
  api: ServerApi;
  /** ownerId = erster Eigentuemer (unentziehbar); weitere Eigentuemer tragen isOwner. */
  members: Member[]; roles: Role[]; myUserId: string; myPermissions: number; ownerId: string | null;
  /** Sprachkanal-Praesenz (channelId -> Mitglieder) und Kanaele fuer die Moderation (verschieben). */
  voice: Record<string, VoiceMember[]>; channels: Channel[];
  /** M7: Freunde ueber das Verzeichnis; null = kein Verzeichnis-Socket (dann keine Eintraege im Menue). */
  friends: { stateOf: (publicKey: string) => Friend["state"] | null; onRequest: (publicKey: string) => void; onMessage: (publicKey: string) => void } | null;
};

/** Rechte Spalte: Eigentuemer ganz oben, dann Mitglieder nach hoechster Rolle gruppiert, online zuerst. Kontextaktionen je nach Recht. */
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
      ? { name: "Eigentümer", color: null, position: Number.MAX_SAFE_INTEGER, members: [] }
      : { name: m.online ? (r?.name ?? "Online") : "Offline", color: m.online ? (r?.color ?? null) : null, position: m.online ? (r?.position ?? 0) : -1, members: [] });
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
                    {m.isOwner && <Icon name="crown" className="owner" title="Eigentümer" />}
                    {m.streamBlocked && <Icon name="video-off" className="muted" title="Kamera/Bildschirm gesperrt" />}
                    {isMe && <span className="muted"> (du)</span>}
                  </button>
                  {open === m.userId && (
                    <div className="member-menu">
                      <div className="muted small">{m.handle && <><strong>@{m.handle}</strong> · </>}{m.publicKey.slice(0, 16)}…</div>
                      {friends && !isMe && (() => {
                        // M7: Freund hinzufuegen / Nachricht schreiben. Ohne Handle hat das Mitglied kein Verzeichniskonto, dann geht keine Freundschaft.
                        const st = friends.stateOf(m.publicKey);
                        return (
                          <div className="row friend-row">
                            {st === "accepted" && <button className="secondary small" onClick={() => { setOpen(null); friends.onMessage(m.publicKey); }}><Icon name="message-circle" /> Nachricht schreiben</button>}
                            {st === "pending_out" && <span className="muted small">Freundschaftsanfrage gesendet</span>}
                            {st === "pending_in" && <button className="secondary small" onClick={() => { setOpen(null); friends.onMessage(m.publicKey); }}>Möchte dein Freund sein: Anfragen ansehen</button>}
                            {st === "blocked" && <span className="muted small">Blockiert</span>}
                            {st === null && (m.handle
                              ? <button className="secondary small" onClick={() => { setOpen(null); friends.onRequest(m.publicKey); }}><Icon name="user-plus" /> Als Freund hinzufügen</button>
                              : <span className="muted small" title="Ohne Handle beim Verzeichnis keine Freundschaft möglich">Kein Verzeichniskonto</span>)}
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
                              ? { title: `${m.displayName} den Eigentümerstatus entziehen?`, text: "Die Rechte richten sich danach wieder nach den Rollen.", confirmLabel: "Entziehen", danger: true }
                              : { title: `${m.displayName} zum Eigentümer machen?`, text: "Eigentümer haben immer alle Rechte, können nicht gekickt oder gebannt werden und dürfen weitere Eigentümer ernennen.", confirmLabel: "Ernennen" });
                            if (ok) await api.setOwner(m.userId, !m.isOwner);
                          })}>{m.isOwner ? "Eigentümerstatus entziehen" : "Zum Eigentümer machen"}</button>
                        </div>
                      )}
                      {!isMe && canModerate && !m.isOwner && (() => {
                        const inVoice = voiceChannelOf(m.userId);
                        return (
                          <div className="stack mod-voice">
                            <span className="muted small">Sprachkanal{inVoice ? `: ${channels.find((c) => c.id === inVoice)?.name ?? "?"}` : ": nicht verbunden"}</span>
                            {inVoice && (
                              <>
                                <select value="" onChange={(e) => { const to = e.target.value; if (to) void run(() => api.moveMember(m.userId, to === "__out" ? null : to)); }}>
                                  <option value="">Verschieben nach …</option>
                                  {voiceChannels.filter((c) => c.id !== inVoice).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  <option value="__out">Aus dem Sprachkanal entfernen</option>
                                </select>
                                <button className="secondary small" onClick={() => run(() => api.stopMemberStreams(m.userId, { camera: true, screen: true }))}>Kamera/Bildschirm beenden</button>
                              </>
                            )}
                            <button className={`${m.streamBlocked ? "" : "danger"} small`} onClick={() => run(() => api.setStreamBlocked(m.userId, !m.streamBlocked))}>
                              {m.streamBlocked ? "Kamera/Bildschirm wieder erlauben" : "Kamera/Bildschirm sperren"}
                            </button>
                          </div>
                        );
                      })()}
                      {!isMe && !m.isOwner && (canKick || canBan) && (
                        <div className="row">
                          {canKick && <button className="secondary small" onClick={() => run(async () => { if (await askConfirm({ title: `${m.displayName} kicken?`, text: "Das Mitglied wird entfernt, kann aber mit einer Einladung wieder beitreten.", confirmLabel: "Kicken", danger: true })) await api.kickMember(m.userId); })}>Kicken</button>}
                          {canBan && <button className="danger small" onClick={() => run(async () => { const reason = await askInput({ title: `${m.displayName} bannen?`, text: "Das Mitglied wird entfernt und kann nicht mehr beitreten, bis der Bann aufgehoben wird.", label: "Grund (optional)", placeholder: "z. B. Spam", optional: true, confirmLabel: "Bannen", danger: true }); if (reason !== null) await api.banMember(m.userId, reason || null); })}>Bannen</button>}
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

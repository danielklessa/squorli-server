import { displayNameOf, type VoiceMember, type VoiceStatus } from "@squorli/protocol";

/**
 * Who is sitting in which voice channel? Tracked per WebSocket connection so a dropped
 * socket removes the user automatically. A user with two tabs counts once.
 *
 * This is intent ("I am in the channel"), not media state; LiveKit knows that.
 * In-memory is enough for a single node (like the ChallengeStore).
 *
 * Restored entries (18 September 2026, user's report: after a server restart the members still talking were missing in
 * the channel list): voice runs at LiveKit and outlives this process and every reconnect of the chat socket, the entries
 * here do not. A client of today says its channel again; for the others the handler asks LiveKit at the hello and puts the
 * member back with `restored`. That is a guess about WHICH connection of the user is in voice, so such an entry gives way
 * as soon as any connection of the user says `voice.join` or `voice.leave`, and the handler drops it when LiveKit no
 * longer lists the participant.
 *
 * Mute state (23 September 2026): a client says with `voice.join` and `voice.status` whether its microphone is muted,
 * whether its sound is off and whether its camera or screen share is on, and the entry carries it (`VoiceMember.micMuted`/
 * `deafened`/`cameraOn`/`screenOn`), so everybody's sidebar and the status API show it without being in the same LiveKit
 * room. A restored entry starts unmuted with nothing on (nothing known).
 */
export class VoicePresence<Conn = unknown> {
  private readonly byConn = new Map<Conn, { channelId: string; member: VoiceMember; restored: boolean; placed: boolean }>();
  private readonly listeners = new Set<(channelId: string, members: VoiceMember[]) => void>();

  onChange(fn: (channelId: string, members: VoiceMember[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Puts the connection into the channel; a previous channel is left. `placed` = a moderator moved the member there
   * (voice/confine.ts): they never needed the permission to enter, so a permission change does not throw them out (livekit/sync.ts).
   */
  join(conn: Conn, channelId: string, member: VoiceMember, restored = false, placed = false): void {
    const prev = this.byConn.get(conn);
    this.byConn.set(conn, { channelId, member, restored, placed });
    if (prev && prev.channelId !== channelId) this.emit(prev.channelId);
    this.emit(channelId);
  }

  leave(conn: Conn): void {
    const prev = this.byConn.get(conn);
    if (!prev) return;
    this.byConn.delete(conn);
    this.emit(prev.channelId);
  }

  /** The user's client spoke for itself (`voice.join`/`voice.leave` on `except`): entries guessed for their other connections go. */
  dropRestored(userId: string, except: Conn): void {
    for (const [conn, entry] of [...this.byConn]) if (entry.restored && conn !== except && entry.member.userId === userId) this.leave(conn);
  }

  /** Entries taken over from LiveKit, for the handler's check that the participant is still there. */
  restoredEntries(): { conn: Conn; channelId: string; userId: string }[] {
    return [...this.byConn].filter(([, e]) => e.restored).map(([conn, e]) => ({ conn, channelId: e.channelId, userId: e.member.userId }));
  }

  /** Remove all connections of a user (kick/ban). */
  leaveUser(userId: string): void {
    for (const [conn, entry] of [...this.byConn]) if (entry.member.userId === userId) this.leave(conn);
  }

  /** Channel deleted: remove all connections in it. */
  clearChannel(channelId: string): void {
    let touched = false;
    for (const [conn, entry] of [...this.byConn]) if (entry.channelId === channelId) { this.byConn.delete(conn); touched = true; }
    if (touched) this.emit(channelId);
  }

  /** Update a user's display name across all of their connections. */
  rename(userId: string, u: { displayName: string | null; publicKey: string; handle?: string | null; localHandle?: string | null }): void {
    const touched = new Set<string>();
    for (const entry of this.byConn.values()) {
      if (entry.member.userId !== userId) continue;
      entry.member = { ...entry.member, displayName: displayNameOf(u) };
      touched.add(entry.channelId);
    }
    for (const channelId of touched) this.emit(channelId);
  }

  /** The connection's client reports its mute state; nothing happens for a connection in no channel or without a change. */
  setStatus(conn: Conn, status: VoiceStatus): void {
    const entry = this.byConn.get(conn);
    if (!entry || (entry.member.micMuted === status.micMuted && entry.member.deafened === status.deafened && entry.member.cameraOn === status.cameraOn && entry.member.screenOn === status.screenOn)) return;
    entry.member = { ...entry.member, micMuted: status.micMuted, deafened: status.deafened, cameraOn: status.cameraOn, screenOn: status.screenOn };
    this.emit(entry.channelId);
  }

  /** Where a user sits and how, for the status API (first connection, like channelOfUser). */
  statusOfUser(userId: string): (VoiceStatus & { channelId: string }) | undefined {
    for (const { channelId, member } of this.byConn.values()) if (member.userId === userId) return { channelId, micMuted: member.micMuted, deafened: member.deafened, cameraOn: member.cameraOn, screenOn: member.screenOn };
    return undefined;
  }

  channelOf(conn: Conn): string | undefined {
    return this.byConn.get(conn)?.channelId;
  }

  /** A user's voice channel (first connection), for moderation. */
  /** The user's other connections that sit in a voice channel: a join from another client ends them (ws/handler.ts). */
  othersOfUser(userId: string, except: Conn): { conn: Conn; channelId: string }[] {
    return [...this.byConn].filter(([conn, e]) => conn !== except && e.member.userId === userId).map(([conn, e]) => ({ conn, channelId: e.channelId }));
  }
  channelOfUser(userId: string): string | undefined {
    for (const entry of this.byConn.values()) if (entry.member.userId === userId) return entry.channelId;
    return undefined;
  }

  /** Did a moderator put the user into this channel (any of their connections there says so)? */
  isPlaced(userId: string, channelId: string): boolean {
    for (const entry of this.byConn.values()) if (entry.member.userId === userId && entry.channelId === channelId && entry.placed) return true;
    return false;
  }

  /** Everyone sitting in a voice channel, once per user (first connection, like channelOfUser). */
  seated(): { userId: string; channelId: string }[] {
    const seen = new Map<string, string>();
    for (const { channelId, member } of this.byConn.values()) if (!seen.has(member.userId)) seen.set(member.userId, channelId);
    return [...seen].map(([userId, channelId]) => ({ userId, channelId }));
  }

  /** Members of a channel, once per user, in join order. */
  members(channelId: string): VoiceMember[] {
    const seen = new Map<string, VoiceMember>();
    for (const { channelId: c, member } of this.byConn.values()) {
      if (c === channelId && !seen.has(member.userId)) seen.set(member.userId, member);
    }
    return [...seen.values()];
  }

  private emit(channelId: string) {
    const members = this.members(channelId);
    for (const fn of this.listeners) fn(channelId, members);
  }
}

import { displayNameOf, type VoiceMember } from "@squorli/protocol";

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
 */
export class VoicePresence<Conn = unknown> {
  private readonly byConn = new Map<Conn, { channelId: string; member: VoiceMember; restored: boolean }>();
  private readonly listeners = new Set<(channelId: string, members: VoiceMember[]) => void>();

  onChange(fn: (channelId: string, members: VoiceMember[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Puts the connection into the channel; a previous channel is left. */
  join(conn: Conn, channelId: string, member: VoiceMember, restored = false): void {
    const prev = this.byConn.get(conn);
    this.byConn.set(conn, { channelId, member, restored });
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
  rename(userId: string, u: { displayName: string | null; publicKey: string; handle?: string | null }): void {
    const touched = new Set<string>();
    for (const entry of this.byConn.values()) {
      if (entry.member.userId !== userId) continue;
      entry.member = { userId, displayName: displayNameOf(u) };
      touched.add(entry.channelId);
    }
    for (const channelId of touched) this.emit(channelId);
  }

  channelOf(conn: Conn): string | undefined {
    return this.byConn.get(conn)?.channelId;
  }

  /** A user's voice channel (first connection), for moderation. */
  channelOfUser(userId: string): string | undefined {
    for (const entry of this.byConn.values()) if (entry.member.userId === userId) return entry.channelId;
    return undefined;
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

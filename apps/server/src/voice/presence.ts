import { displayNameOf, type VoiceMember } from "@squorli/protocol";

/**
 * Who is sitting in which voice channel? Tracked per WebSocket connection so a dropped
 * socket removes the user automatically. A user with two tabs counts once.
 *
 * This is intent ("I am in the channel"), not media state; LiveKit knows that.
 * In-memory is enough for a single node (like the ChallengeStore).
 */
export class VoicePresence<Conn = unknown> {
  private readonly byConn = new Map<Conn, { channelId: string; member: VoiceMember }>();
  private readonly listeners = new Set<(channelId: string, members: VoiceMember[]) => void>();

  onChange(fn: (channelId: string, members: VoiceMember[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Puts the connection into the channel; a previous channel is left. */
  join(conn: Conn, channelId: string, member: VoiceMember): void {
    const prev = this.byConn.get(conn);
    this.byConn.set(conn, { channelId, member });
    if (prev && prev.channelId !== channelId) this.emit(prev.channelId);
    this.emit(channelId);
  }

  leave(conn: Conn): void {
    const prev = this.byConn.get(conn);
    if (!prev) return;
    this.byConn.delete(conn);
    this.emit(prev.channelId);
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

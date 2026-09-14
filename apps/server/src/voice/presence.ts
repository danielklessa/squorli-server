import { displayNameOf, type VoiceMember } from "@squorli/protocol";

/**
 * Wer sitzt in welchem Sprachkanal? Gefuehrt pro WebSocket-Verbindung, damit ein abgerissener
 * Socket den Nutzer automatisch austraegt. Ein Nutzer mit zwei Tabs zaehlt einmal.
 *
 * Das ist Absicht ("ich bin im Kanal"), nicht der Medienstatus; den kennt LiveKit.
 * In-Memory reicht fuer einen Knoten (wie der ChallengeStore).
 */
export class VoicePresence<Conn = unknown> {
  private readonly byConn = new Map<Conn, { channelId: string; member: VoiceMember }>();
  private readonly listeners = new Set<(channelId: string, members: VoiceMember[]) => void>();

  onChange(fn: (channelId: string, members: VoiceMember[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Setzt die Verbindung in den Kanal; ein vorheriger Kanal wird verlassen. */
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

  /** Alle Verbindungen eines Nutzers austragen (Kick/Ban). */
  leaveUser(userId: string): void {
    for (const [conn, entry] of [...this.byConn]) if (entry.member.userId === userId) this.leave(conn);
  }

  /** Kanal geloescht: alle Verbindungen darin austragen. */
  clearChannel(channelId: string): void {
    let touched = false;
    for (const [conn, entry] of [...this.byConn]) if (entry.channelId === channelId) { this.byConn.delete(conn); touched = true; }
    if (touched) this.emit(channelId);
  }

  /** Anzeigename eines Nutzers in allen seinen Verbindungen aktualisieren. */
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

  /** Sprachkanal eines Nutzers (erste Verbindung), fuer Moderation. */
  channelOfUser(userId: string): string | undefined {
    for (const entry of this.byConn.values()) if (entry.member.userId === userId) return entry.channelId;
    return undefined;
  }

  /** Mitglieder eines Kanals, je Nutzer einmal, in Beitrittsreihenfolge. */
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

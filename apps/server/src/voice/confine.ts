/**
 * Sticky voice channels and moderator moves (docs/features/channel-permissions.md, 23 September 2026).
 *
 * A member held by a sticky channel (members.confined_channel_id) gets no LiveKit token for any other voice channel until
 * somebody with MOVE_MEMBERS moves them; BYPASS_STICKY, owners and administrators are never held. The decision is pure so
 * it can be tested; the routes feed it.
 *
 * A move is advisory: the server sends voice.moved, the client fetches a token for the target and joins, and that join is
 * checked like any other. A member moved into a channel they may not see or enter would therefore be refused by their own
 * join, so the move leaves a short-lived grant here that lets exactly that channel through once; the visibility snapshot
 * shows them the channel meanwhile (visibility.ts). In memory: after a restart the moderator simply moves again.
 */
export const MOVE_GRANT_MS = 60_000;

export class MoveGrants {
  private readonly byUser = new Map<string, { channelId: string; until: number }>();

  grant(userId: string, channelId: string, now = Date.now()): void {
    this.byUser.set(userId, { channelId, until: now + MOVE_GRANT_MS });
  }

  /** The channel a live grant names, if any. */
  grantOf(userId: string, now = Date.now()): string | undefined {
    const g = this.byUser.get(userId);
    if (!g) return undefined;
    if (g.until <= now) { this.byUser.delete(userId); return undefined; }
    return g.channelId;
  }

  /** The member joined the channel: the grant did its job. */
  consume(userId: string, channelId: string): void {
    if (this.byUser.get(userId)?.channelId === channelId) this.byUser.delete(userId);
  }

  clear(userId: string): void { this.byUser.delete(userId); }
}

/** The one instance (index.ts hands it to the visibility snapshot). */
export const moveGrants = new MoveGrants();

export type ConfinementInput = {
  /** BYPASS_STICKY in the holding channel, an owner or an administrator. */
  bypass: boolean;
  /** members.confined_channel_id, when that channel is still sticky. */
  confinedTo: string | null;
  /** The channel the member asks a token for. */
  wanted: string;
  /** A live move grant names the wanted channel. */
  granted: boolean;
};

/** May the member get a token for the wanted channel? */
export function confinementVerdict(i: ConfinementInput): "ok" | "confined" {
  if (i.bypass || i.confinedTo === null || i.confinedTo === i.wanted || i.granted) return "ok";
  return "confined";
}

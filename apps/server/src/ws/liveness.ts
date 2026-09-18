/**
 * Which WebSocket connections are still alive? (User's report of 18 September 2026: a member sat in two voice channels at
 * once and never turned AFK.) A connection whose other end vanished without a close (sleep, network change, a killed
 * process behind a proxy) stays open for the server: it keeps its voice presence, and because it never reports idle it
 * keeps its user "present" for the AFK detection (hub.ts: AFK = ALL connections idle).
 *
 * The handler pings every connection on the WebSocket level every PING_EVERY_MS; browsers answer that by themselves, also
 * clients from before this rule and throttled background tabs. Nothing heard for DEAD_AFTER_MS = dead, the handler
 * terminates it. A connection that still answers pings but whose client code has sent nothing for STALE_AFTER_MS (its own
 * `ping` comes every 20 s, once a minute in a throttled background tab) belongs to a frozen page: it cannot report idle,
 * so it counts as idle until the client speaks again.
 */
export const PING_EVERY_MS = 30_000;
export const DEAD_AFTER_MS = 90_000;
export const STALE_AFTER_MS = 150_000;

export class Liveness<Conn> {
  private readonly seen = new Map<Conn, { any: number; app: number; stale: boolean }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  add(conn: Conn): void {
    const t = this.now();
    this.seen.set(conn, { any: t, app: t, stale: false });
  }

  remove(conn: Conn): void {
    this.seen.delete(conn);
  }

  connections(): Conn[] {
    return [...this.seen.keys()];
  }

  /** Something arrived; `app` = a message of the client's code (not the pong frame). Returns true when that ends a stale phase. */
  heard(conn: Conn, app: boolean): boolean {
    const entry = this.seen.get(conn);
    if (!entry) return false;
    entry.any = this.now();
    if (!app) return false;
    entry.app = entry.any;
    const wasStale = entry.stale;
    entry.stale = false;
    return wasStale;
  }

  /** Connections to terminate, and connections that turned stale since the last sweep. */
  sweep(): { dead: Conn[]; stale: Conn[] } {
    const t = this.now();
    const dead: Conn[] = [], stale: Conn[] = [];
    for (const [conn, entry] of this.seen) {
      if (t - entry.any >= DEAD_AFTER_MS) dead.push(conn);
      else if (!entry.stale && t - entry.app >= STALE_AFTER_MS) { entry.stale = true; stale.push(conn); }
    }
    return { dead, stale };
  }
}

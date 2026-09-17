import { AFK_AFTER_MS, type ServerEvent } from "@squorli/protocol";
import type { WebSocket } from "ws";

/**
 * All authenticated WebSocket connections, grouped by user.
 * Presence (online) = at least one connection. Single node, in memory.
 *
 * AFK detection: a client reports per connection when its user has been idle for AFK_AFTER_MS (`activity`); a user is AFK
 * once ALL of their connections are idle (a second tab or device in use keeps them present). The AFK map remembers the
 * time of the last activity as far as the server can tell, so the move to the AFK channel can wait for the admin's time.
 * Presence listeners also fire when the AFK state changes (`online` stays true).
 */
export class Hub {
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private readonly userOf = new Map<WebSocket, string>();
  /** Session per connection, so a remote sign-out (M6c) closes exactly that connection. */
  private readonly sessionOf = new Map<WebSocket, string>();
  /** Idle connections -> when their user was last active there (the report arrives AFK_AFTER_MS later). */
  private readonly idleSince = new Map<WebSocket, number>();
  /** AFK users -> time of their last activity. */
  private readonly afk = new Map<string, number>();
  private readonly listeners = new Set<(userId: string, online: boolean) => void>();

  onPresence(fn: (userId: string, online: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(userId: string, ws: WebSocket, sessionId: string) {
    let set = this.byUser.get(userId);
    const wasOnline = !!set && set.size > 0;
    if (!set) { set = new Set(); this.byUser.set(userId, set); }
    set.add(ws);
    this.userOf.set(ws, userId);
    this.sessionOf.set(ws, sessionId);
    // A new connection counts as active: somebody just opened or reloaded the client.
    const wasAfk = this.afk.delete(userId);
    if (!wasOnline || wasAfk) for (const fn of this.listeners) fn(userId, true);
  }

  remove(ws: WebSocket, now = Date.now()) {
    const userId = this.userOf.get(ws);
    if (!userId) return;
    this.userOf.delete(ws);
    this.sessionOf.delete(ws);
    const wasIdle = this.idleSince.delete(ws);
    const set = this.byUser.get(userId);
    set?.delete(ws);
    if (set && set.size === 0) {
      this.byUser.delete(userId);
      this.afk.delete(userId);
      for (const fn of this.listeners) fn(userId, false);
    } else if (!wasIdle && this.refreshAfk(userId, now)) {
      // The connection in use is gone and only idle ones remain: absent, counted from now.
      for (const fn of this.listeners) fn(userId, true);
    }
  }

  /** A connection reports its user idle (no activity for AFK_AFTER_MS) or back. */
  setIdle(ws: WebSocket, idle: boolean, now = Date.now()) {
    const userId = this.userOf.get(ws);
    if (!userId || idle === this.idleSince.has(ws)) return;
    if (idle) this.idleSince.set(ws, now - AFK_AFTER_MS); else this.idleSince.delete(ws);
    if (this.refreshAfk(userId)) for (const fn of this.listeners) fn(userId, true);
  }

  /** Recompute a user's AFK state; true = it changed. `lastActive` overrides the connections' own times (an active connection just closed). */
  private refreshAfk(userId: string, lastActive?: number): boolean {
    const conns = [...(this.byUser.get(userId) ?? [])];
    const all = conns.length > 0 && conns.every((ws) => this.idleSince.has(ws));
    if (all === this.afk.has(userId)) return false;
    if (all) this.afk.set(userId, lastActive ?? Math.max(...conns.map((ws) => this.idleSince.get(ws) ?? 0)));
    else this.afk.delete(userId);
    return true;
  }

  isAfk(userId: string): boolean {
    return this.afk.has(userId);
  }

  /** AFK users with the time of their last activity. */
  afkUsers(): [userId: string, lastActive: number][] {
    return [...this.afk];
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  onlineUserIds(): string[] {
    return [...this.byUser.keys()];
  }

  send(ws: WebSocket, e: ServerEvent) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
  }

  sendToUser(userId: string, e: ServerEvent) {
    for (const ws of this.byUser.get(userId) ?? []) this.send(ws, e);
  }

  broadcast(e: ServerEvent, except?: WebSocket) {
    const text = JSON.stringify(e);
    for (const ws of this.userOf.keys()) if (ws !== except && ws.readyState === ws.OPEN) ws.send(text);
  }

  /** Throw a user out: send the event, then close all of their connections. */
  disconnectUser(userId: string, e: ServerEvent, code = 4010) {
    for (const ws of [...(this.byUser.get(userId) ?? [])]) {
      this.send(ws, e);
      ws.close(code, e.type);
    }
  }

  /** Close all connections of a user with a bare close code (no event), e.g. 4012 `account_deleted` after a deletion via the directory. */
  closeUser(userId: string, code: number, reason: string) {
    for (const ws of [...(this.byUser.get(userId) ?? [])]) ws.close(code, reason);
  }

  /** Remote sign-out (M6c): close only the connections of this session. The client recognizes the code and goes to the login. */
  disconnectSession(sessionId: string, code = 4011, reason = "session_revoked") {
    for (const [ws, sid] of [...this.sessionOf]) if (sid === sessionId) ws.close(code, reason);
  }
}

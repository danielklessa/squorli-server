import type { ServerEvent } from "@squorli/protocol";
import type { WebSocket } from "ws";

/**
 * All authenticated WebSocket connections, grouped by user.
 * Presence (online) = at least one connection. Single node, in memory.
 */
export class Hub {
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private readonly userOf = new Map<WebSocket, string>();
  /** Session per connection, so a remote sign-out (M6c) closes exactly that connection. */
  private readonly sessionOf = new Map<WebSocket, string>();
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
    if (!wasOnline) for (const fn of this.listeners) fn(userId, true);
  }

  remove(ws: WebSocket) {
    const userId = this.userOf.get(ws);
    if (!userId) return;
    this.userOf.delete(ws);
    this.sessionOf.delete(ws);
    const set = this.byUser.get(userId);
    set?.delete(ws);
    if (set && set.size === 0) {
      this.byUser.delete(userId);
      for (const fn of this.listeners) fn(userId, false);
    }
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

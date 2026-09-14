import type { ServerEvent } from "@squorli/protocol";
import type { WebSocket } from "ws";

/**
 * Alle authentifizierten WebSocket-Verbindungen, nach Nutzer gruppiert.
 * Praesenz (online) = mindestens eine Verbindung. Ein Knoten, in-memory.
 */
export class Hub {
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private readonly userOf = new Map<WebSocket, string>();
  /** Sitzung je Verbindung, damit eine Fernabmeldung (M6c) genau diese Verbindung schliesst. */
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

  /** Nutzer rauswerfen: Ereignis senden, dann alle seine Verbindungen schliessen. */
  disconnectUser(userId: string, e: ServerEvent, code = 4010) {
    for (const ws of [...(this.byUser.get(userId) ?? [])]) {
      this.send(ws, e);
      ws.close(code, e.type);
    }
  }

  /** Fernabmeldung (M6c): nur die Verbindungen dieser Sitzung schliessen. Der Client erkennt den Code und geht zum Login. */
  disconnectSession(sessionId: string, code = 4011, reason = "session_revoked") {
    for (const [ws, sid] of [...this.sessionOf]) if (sid === sessionId) ws.close(code, reason);
  }
}

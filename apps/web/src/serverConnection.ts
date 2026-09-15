import { PROTOCOL_VERSION, ServerEvent, type ClientEvent, type Me, type Message, type ServerState, type VoiceMember } from "@squorli/protocol";
import { ServerApi, explainLoginError, type Health } from "./api";
import type { Identity } from "./identity";
import { t } from "./i18n";

/**
 * Connection to exactly one chat server (multi-server client): session, WebSocket with reconnect, server state,
 * message cache, voice channel presence, typing indicator. The store holds one connection per server (own server = the one
 * that serves the client; foreign servers from the server rail via their origin) and displays the active one.
 */
export type Connection = "idle" | "logging-in" | "connecting" | "connected" | "reconnecting" | "error";

export type ChannelMessages = { list: Message[]; hasMore: boolean; loaded: boolean; loading: boolean };

export type RawLogEntry = { dir: "in" | "out"; at: number; text: string };

export type ServerConnState = {
  /** Key in the store: own server = the host in the address bar, foreign ones = the host from the directory (PUBLIC_DOMAIN). */
  host: string;
  /** Origin of the server for REST/WS; "" = own server (relative paths). */
  base: string;
  me: Me | null;
  userId: string | null;
  connection: Connection;
  error: string | null;
  /** The server removed us; sign in again only after a user action. */
  removed: { reason: "kicked" | "banned"; message: string | null } | null;
  server: ServerState | null;
  voice: Record<string, VoiceMember[]>;
  messages: Record<string, ChannelMessages>;
  /** channelId -> userId -> timestamp of the last typing event */
  typing: Record<string, Record<string, number>>;
  currentChannelId: string | null;
  /** Channel with unread messages (since it was last viewed). */
  unread: Record<string, boolean>;
  log: RawLogEntry[];
  /** Server name and icon from /api/health (the icon already resolved against the server), for title/favicon/rail even before sign-in. */
  serverName: string | null;
  iconUrl: string | null;
  /** This server's PUBLIC_DOMAIN (from /api/health): its key in the directory and the domain of the login signature for foreign servers. */
  serverDomain: string | null;
  /** Sign-in only with a directory account (from /api/health). */
  requireAccount: boolean;
  serverVersion: string | null;
  /** Directory service named by this server; null = none. */
  directoryUrl: string | null;
};

export type ConnectionHooks = {
  onState: (s: ServerConnState) => void;
  /** Remember the session token (null = forget it). */
  onToken: (token: string | null) => void;
  /** Session gone (remote sign-out, expired, membership lost): the store decides what that means for the client. */
  onSessionLost: (message: string) => void;
  /** Kick/ban: end the voice connection if it belongs to this server. */
  onRemoved: () => void;
  /** First welcome of a session (not after a reconnect): e.g. refresh the server list at the directory. */
  onConnected: () => void;
  /** Moderation (M3): moving to another voice channel (null = out) and stopping camera/screen. */
  onVoiceMoved: (channelId: string | null, by: string) => void;
  onVoiceStop: (what: { camera: boolean; screen: boolean }, by: string) => void;
};

const LOG_MAX = 80;
const EMPTY: ChannelMessages = { list: [], hasMore: true, loaded: false, loading: false };

export class ServerConnection {
  readonly api: ServerApi;
  state: ServerConnState;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private wantConnection = false;
  private pingTimer: number | null = null;

  constructor(host: string, base: string, private readonly identity: () => Identity | null, private readonly hooks: ConnectionHooks) {
    this.api = new ServerApi(base);
    this.state = {
      host, base, me: null, userId: null, connection: "idle", error: null, removed: null, server: null,
      voice: {}, messages: {}, typing: {}, currentChannelId: null, unread: {}, log: [],
      serverName: null, iconUrl: null, serverDomain: null, requireAccount: false, serverVersion: null, directoryUrl: null,
    };
    // Token rejected by the server (expired, signed out from another device): do not keep running with a dead token.
    this.api.onUnauthorized = () => { if (this.state.me) this.sessionLost("Die Sitzung ist abgelaufen oder wurde abgemeldet. Bitte erneut anmelden."); };
  }

  private set(p: Partial<ServerConnState>) { this.state = { ...this.state, ...p }; this.hooks.onState(this.state); }

  /** Read /api/health: name, icon, domain, directory. null if the server is unreachable. */
  async refreshHealth(): Promise<Health | null> {
    const health = await this.api.getHealth().catch(() => null);
    this.set({
      serverName: health?.serverName ?? null, iconUrl: health?.iconUrl ? this.api.abs(health.iconUrl) : null, serverDomain: health?.domain?.toLowerCase() ?? null,
      directoryUrl: health?.directoryUrl ?? null, requireAccount: !!health?.directoryUrl && health?.requireAccount === true, serverVersion: health?.version ?? null,
    });
    return health;
  }

  /** Reuse the stored session if it is still valid. */
  async resume(token: string): Promise<boolean> {
    this.api.setToken(token);
    this.set({ connection: "connecting", error: null });
    const me = await this.api.getMe().catch(() => null);
    if (!me) { this.api.setToken(null); this.set({ connection: "idle" }); return false; }
    this.set({ me, userId: me.userId });
    this.connect();
    return true;
  }

  /** Sign in (challenge-response) with a signature over `domain`, optionally with an invite, then connect the WebSocket. */
  async login(domain: string, invite?: string): Promise<void> {
    const id = this.identity();
    if (!id) return;
    this.set({ connection: "logging-in", error: null, removed: null });
    try {
      const session = await this.api.login(id, domain, invite);
      this.api.setToken(session.sessionToken);
      this.hooks.onToken(session.sessionToken);
      const me = await this.api.getMe();
      this.set({ me, userId: me.userId });
      this.connect();
    } catch (err) {
      const code = err instanceof Error && "code" in err ? (err as { code: string | null }).code : null;
      this.set({ connection: "error", error: await explainLoginError(err, this.api, domain) });
      throw Object.assign(new Error("login failed"), { code });
    }
  }

  /** Sign out: end the session on the server side too (M6c, best effort) and close the connection. */
  logout() {
    if (this.api.getToken()) void this.api.logoutSession().catch(() => {});
    this.clearSession(null);
  }

  private sessionLost(message: string) {
    this.hooks.onRemoved();
    this.clearSession(message);
    this.hooks.onSessionLost(message);
  }

  /** The account on this server was deleted at the user's request (via the directory): drop the session, show the login with a note. */
  accountDeleted() {
    if (this.state.me || this.api.getToken()) this.sessionLost(t("err.accountDeleted"));
  }

  private clearSession(error: string | null) {
    this.close();
    this.api.setToken(null);
    this.hooks.onToken(null);
    this.set({ me: null, userId: null, connection: "idle", server: null, messages: {}, voice: {}, currentChannelId: null, removed: null, error });
  }

  /** Close the connection without forgetting the session (e.g. on an identity switch). */
  close() {
    this.wantConnection = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  // ---------- WebSocket
  private connect() {
    this.wantConnection = true;
    const token = this.api.getToken();
    if (!token) return;
    this.set({ connection: this.state.server ? "reconnecting" : "connecting" });
    const base = this.state.base || window.location.origin;
    const ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/ws`);
    this.ws = ws;
    ws.onopen = () => this.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, sessionToken: token });
    ws.onmessage = (m) => {
      this.pushLog({ dir: "in", at: Date.now(), text: String(m.data).slice(0, 2000) });
      const parsed = ServerEvent.safeParse(JSON.parse(m.data));
      if (parsed.success) this.handle(parsed.data);
    };
    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      // 4011 = session signed out from another device (M6c), 4012 = account deleted via the directory: do not reconnect, go back to the login.
      if (ev.code === 4011 && this.wantConnection) return this.sessionLost(t("err.sessionRevoked"));
      if (ev.code === 4012 && this.wantConnection) return this.sessionLost(t("err.accountDeleted"));
      if (!this.wantConnection) return;
      this.set({ connection: "reconnecting" });
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(15_000, this.reconnectDelay * 2);
    };
  }

  send(e: ClientEvent) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(e);
    this.pushLog({ dir: "out", at: Date.now(), text });
    this.ws.send(text);
  }

  private pushLog(e: RawLogEntry) { this.set({ log: [...this.state.log.slice(-(LOG_MAX - 1)), e] }); }

  private handle(e: ServerEvent) {
    switch (e.type) {
      case "welcome": {
        this.reconnectDelay = 1000;
        const wasReconnect = this.state.server !== null;
        const current = this.state.currentChannelId && e.state.channels.some((c) => c.id === this.state.currentChannelId)
          ? this.state.currentChannelId
          : e.state.channels.find((c) => c.kind === "text")?.id ?? null;
        this.set({ server: e.state, userId: e.userId, connection: "connected", currentChannelId: current, error: null });
        if (!wasReconnect) this.hooks.onConnected();
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.send({ type: "ping", t: Date.now() }), 20_000);
        // After a reconnect: reload the current channel's history, messages could be missing.
        if (wasReconnect && current) { this.set({ messages: { ...this.state.messages, [current]: EMPTY } }); void this.loadHistory(current); }
        else if (current) void this.loadHistory(current);
        break;
      }
      case "structure": {
        const server = this.state.server;
        if (!server) break;
        const next: ServerState = {
          ...server,
          ...(e.settings ? { settings: e.settings } : {}),
          ...(e.categories ? { categories: e.categories } : {}),
          ...(e.channels ? { channels: e.channels } : {}),
          ...(e.roles ? { roles: e.roles } : {}),
          ...(e.members ? { members: e.members } : {}),
        };
        const current = this.state.currentChannelId && next.channels.some((c) => c.id === this.state.currentChannelId)
          ? this.state.currentChannelId : next.channels.find((c) => c.kind === "text")?.id ?? null;
        this.set({ server: next, currentChannelId: current });
        break;
      }
      case "me":
        if (this.state.server) this.set({ server: { ...this.state.server, myPermissions: e.myPermissions } });
        break;
      case "voice.state":
        this.set({ voice: { ...this.state.voice, [e.channelId]: e.members } });
        break;
      case "voice.moved":
        this.hooks.onVoiceMoved(e.channelId, e.by);
        break;
      case "voice.stop":
        this.hooks.onVoiceStop({ camera: e.camera, screen: e.screen }, e.by);
        break;
      case "message.create": {
        const ch = this.state.messages[e.message.channelId];
        if (ch?.loaded && !ch.list.some((m) => m.id === e.message.id)) {
          this.set({ messages: { ...this.state.messages, [e.message.channelId]: { ...ch, list: [...ch.list, e.message] } } });
        }
        const typing = { ...(this.state.typing[e.message.channelId] ?? {}) };
        delete typing[e.message.authorId];
        const unread = e.message.channelId !== this.state.currentChannelId && e.message.authorId !== this.state.userId;
        this.set({ typing: { ...this.state.typing, [e.message.channelId]: typing }, unread: unread ? { ...this.state.unread, [e.message.channelId]: true } : this.state.unread });
        break;
      }
      case "message.update": {
        const ch = this.state.messages[e.message.channelId];
        if (ch) this.set({ messages: { ...this.state.messages, [e.message.channelId]: { ...ch, list: ch.list.map((m) => (m.id === e.message.id ? e.message : m)) } } });
        break;
      }
      case "message.delete": {
        const ch = this.state.messages[e.channelId];
        if (ch) this.set({ messages: { ...this.state.messages, [e.channelId]: { ...ch, list: ch.list.filter((m) => m.id !== e.id) } } });
        break;
      }
      case "typing":
        this.set({ typing: { ...this.state.typing, [e.channelId]: { ...(this.state.typing[e.channelId] ?? {}), [e.userId]: Date.now() } } });
        break;
      case "removed":
        this.wantConnection = false;
        this.hooks.onRemoved();
        this.set({ removed: { reason: e.reason, message: e.message }, connection: "idle", server: null, messages: {}, voice: {} });
        break;
      case "error":
        if (e.code === "unauthorized") {
          // Token invalid or membership lost: do not stay in the chat with a dead socket.
          this.sessionLost(e.message === "not a member" ? t("err.notMember") : t("err.sessionInvalid"));
        } else if (e.code === "protocol_version") {
          this.wantConnection = false;
          this.set({ connection: "error", error: `${e.code}: ${e.message}` });
        }
        break;
      case "pong":
        break;
    }
  }

  // ---------- Channels and messages
  selectChannel(channelId: string) {
    this.set({ currentChannelId: channelId, unread: { ...this.state.unread, [channelId]: false } });
    if (!this.state.messages[channelId]?.loaded) void this.loadHistory(channelId);
  }

  async loadHistory(channelId: string, older = false) {
    const ch = this.state.messages[channelId] ?? EMPTY;
    if (ch.loading || (older && !ch.hasMore)) return;
    this.set({ messages: { ...this.state.messages, [channelId]: { ...ch, loading: true } } });
    try {
      const before = older ? ch.list[0]?.seq : undefined;
      const page = await this.api.getMessages(channelId, before);
      const cur = this.state.messages[channelId] ?? EMPTY;
      const merged = older ? [...page.messages, ...cur.list] : mergeLatest(cur.list, page.messages);
      this.set({ messages: { ...this.state.messages, [channelId]: { list: merged, hasMore: older ? page.hasMore : (cur.loaded ? cur.hasMore : page.hasMore), loaded: true, loading: false } } });
    } catch (err) {
      this.set({ messages: { ...this.state.messages, [channelId]: { ...ch, loading: false } }, error: String(err) });
    }
  }

  async sendMessage(channelId: string, content: string, files: File[]) {
    const attachmentIds: string[] = [];
    for (const f of files) attachmentIds.push((await this.api.uploadAttachment(f)).id);
    const msg = await this.api.sendMessage(channelId, content, attachmentIds);
    const ch = this.state.messages[channelId];
    if (ch?.loaded && !ch.list.some((m) => m.id === msg.id)) {
      this.set({ messages: { ...this.state.messages, [channelId]: { ...ch, list: [...ch.list, msg] } } });
    }
  }

  typing(channelId: string) { this.send({ type: "typing", channelId }); }

  clearError() { this.set({ error: null }); }
}

/** Merge the newest page with the existing cache (after a reconnect), without duplicates. */
function mergeLatest(cur: Message[], page: Message[]): Message[] {
  if (!cur.length) return page;
  const known = new Set(cur.map((m) => m.id));
  const byId = new Map(page.map((m) => [m.id, m]));
  const updated = cur.map((m) => byId.get(m.id) ?? m);
  return [...updated, ...page.filter((m) => !known.has(m.id))].sort((a, b) => a.seq - b.seq);
}

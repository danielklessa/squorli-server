import { PROTOCOL_VERSION, ServerEvent, type ClientEvent, type Me, type Message, type ServerState, type VoiceMember } from "@squorli/protocol";
import { ServerApi, explainLoginError, type Health } from "./api";
import type { Identity } from "./identity";
import { t } from "./i18n";
import { mentionsUser } from "./mentions";
import { catchUp, loadReadState, markRead, pruneReadState, saveReadState, type ReadState } from "./readState";

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
  /** Channel with unread messages (since it was last viewed; also from before this session, see readState.ts). */
  unread: Record<string, boolean>;
  /** Messages that mention me per channel, since it was last viewed (like `unread`, also from before this session). */
  mentions: Record<string, number>;
  /** Channels I have muted and whether I have muted this whole server: no unread marks for them (mentions still show). Kept by the server. */
  muted: Record<string, boolean>;
  serverMuted: boolean;
  /** The server keeps read states and mutes (false = older server: marks per device, no muting). */
  readSync: boolean;
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
/** After connecting, at most this many text channels are checked for messages that arrived while we were away. */
const CATCH_UP_CHANNELS = 50;
const READ_SYNC_MIN_MS = 15_000;
const READ_ACK_DELAY_MS = 800;
const EMPTY: ChannelMessages = { list: [], hasMore: true, loaded: false, loading: false };

export class ServerConnection {
  readonly api: ServerApi;
  state: ServerConnState;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private wantConnection = false;
  private pingTimer: number | null = null;
  /** Newest message shown per channel (readState.ts), loaded for the signed-in user at every welcome. */
  private read: ReadState = {};
  /** The server keeps read states (GET /api/read-state answered): marks come from there and hold on every device. */
  private serverRead = false;
  /** What the server has acknowledged as read per channel, and pending acknowledgements (coalesced). */
  private acked: ReadState = {};
  private ackTimers = new Map<string, number>();
  /** Newest live message of other people per channel that is not on screen: an older answer of the server must not clear its mark. */
  private liveLatest: ReadState = {};
  private lastReadSync = 0;

  constructor(host: string, base: string, private readonly identity: () => Identity | null, private readonly hooks: ConnectionHooks) {
    this.api = new ServerApi(base);
    this.state = {
      host, base, me: null, userId: null, connection: "idle", error: null, removed: null, server: null,
      voice: {}, messages: {}, typing: {}, currentChannelId: null, unread: {}, mentions: {}, muted: {}, serverMuted: false, readSync: false, log: [],
      serverName: null, iconUrl: null, serverDomain: null, requireAccount: false, serverVersion: null, directoryUrl: null,
    };
    // Token rejected by the server (expired, signed out from another device): do not keep running with a dead token.
    // Back in front of this tab: another device may have read channels meanwhile (normally `read.update` says so right away).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.serverRead && this.state.connection === "connected" && Date.now() - this.lastReadSync > READ_SYNC_MIN_MS) void this.syncReadState();
    });
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
    for (const timer of this.ackTimers.values()) clearTimeout(timer);
    this.ackTimers.clear(); this.acked = {}; this.liveLatest = {}; this.serverRead = false;
    this.set({ me: null, userId: null, connection: "idle", server: null, messages: {}, voice: {}, currentChannelId: null, unread: {}, mentions: {}, muted: {}, serverMuted: false, readSync: false, removed: null, error });
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
        this.read = pruneReadState(loadReadState(this.state.host, e.userId), e.state.channels.map((c) => c.id));
        void this.syncReadState();
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
        if (e.message.channelId === this.state.currentChannelId) this.rememberRead(e.message.channelId, [e.message]);
        if (unread) this.liveLatest = { ...this.liveLatest, [e.message.channelId]: e.message.seq };
        const mentioned = unread && this.state.userId !== null && mentionsUser(e.message.content, this.state.userId);
        this.set({
          typing: { ...this.state.typing, [e.message.channelId]: typing },
          unread: unread ? { ...this.state.unread, [e.message.channelId]: true } : this.state.unread,
          mentions: mentioned ? { ...this.state.mentions, [e.message.channelId]: (this.state.mentions[e.message.channelId] ?? 0) + 1 } : this.state.mentions,
        });
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
      case "read.update": {
        // One of my devices (this one included) has read a channel.
        this.acked = { ...this.acked, [e.channelId]: Math.max(this.acked[e.channelId] ?? -1, e.lastReadSeq) };
        if (this.state.userId && (this.read[e.channelId] ?? -1) < e.lastReadSeq) { this.read = { ...this.read, [e.channelId]: e.lastReadSeq }; saveReadState(this.state.host, this.state.userId, this.read); }
        if (e.channelId === this.state.currentChannelId) break;
        const list = this.state.messages[e.channelId]?.list ?? [];
        const newest = Math.max(this.liveLatest[e.channelId] ?? -1, list[list.length - 1]?.seq ?? -1);
        if (newest <= e.lastReadSeq) this.set({ unread: { ...this.state.unread, [e.channelId]: false }, mentions: { ...this.state.mentions, [e.channelId]: 0 } });
        else void this.syncReadState();   // read only in part over there: let the server count what is left
        break;
      }
      case "mute.update":
        this.set({ serverMuted: e.serverMuted, muted: Object.fromEntries(e.channelIds.map((id) => [id, true])) });
        break;
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
  /** Change your display name on this server; `me` follows right away (the member list follows via the server's broadcast). */
  async updateDisplayName(displayName: string | null): Promise<void> {
    const me = await this.api.updateMe(displayName);
    this.set({ me });
  }

  /** Mute or unmute a text channel / this whole server for myself (kept by the server, so it holds on every device). */
  async setChannelMuted(channelId: string, muted: boolean): Promise<void> { this.applyMutes(await this.api.setChannelMuted(channelId, muted)); }
  async setServerMuted(muted: boolean): Promise<void> { this.applyMutes(await this.api.setServerMuted(muted)); }
  private applyMutes(m: { serverMuted: boolean; channelIds: string[] }) { this.set({ serverMuted: m.serverMuted, muted: Object.fromEntries(m.channelIds.map((id) => [id, true])) }); }

  selectChannel(channelId: string) {
    this.set({ currentChannelId: channelId, unread: { ...this.state.unread, [channelId]: false }, mentions: { ...this.state.mentions, [channelId]: 0 } });
    this.rememberRead(channelId, this.state.messages[channelId]?.list ?? []);
    if (!this.state.messages[channelId]?.loaded) void this.loadHistory(channelId);
  }

  /**
   * The channel is on screen: its newest message counts as read from now on. Told to the server (all my devices) when it
   * keeps read states, and always remembered on this device (readState.ts) for servers that do not.
   */
  private rememberRead(channelId: string, shown: readonly Message[]) {
    const userId = this.state.userId;
    if (!userId) return;
    const next = markRead(this.read, channelId, shown);
    if (next !== this.read) { this.read = next; saveReadState(this.state.host, userId, next); }
    this.acknowledge(channelId);
  }

  /** Coalesced: a busy open channel sends one acknowledgement per pause, not one per message. */
  private acknowledge(channelId: string) {
    const seq = this.read[channelId];
    if (!this.serverRead || seq === undefined || seq <= (this.acked[channelId] ?? -1) || this.ackTimers.has(channelId)) return;
    this.ackTimers.set(channelId, window.setTimeout(() => {
      this.ackTimers.delete(channelId);
      const latest = this.read[channelId];
      if (latest === undefined || !this.serverRead) return;
      this.api.markRead(channelId, latest).then(
        (r) => { this.acked = { ...this.acked, [channelId]: Math.max(this.acked[channelId] ?? -1, r.lastReadSeq) }; },
        () => { /* offline or no access: the next message or the next welcome tries again */ },
      );
    }, READ_ACK_DELAY_MS));
  }

  /**
   * After every welcome (and when the tab comes back): ask the server how far I have read each text channel, on whatever
   * device, and take its marks and mention counts. A server without read states (older version) answers 404: then this
   * device's own state decides (`catchUpChannels`).
   */
  private async syncReadState() {
    const userId = this.state.userId;
    if (!userId) return;
    let remote;
    try { remote = await this.api.getReadState(); } catch { this.serverRead = false; this.set({ readSync: false }); return this.catchUpChannels(); }
    if (this.state.userId !== userId) return;
    this.serverRead = true;
    this.lastReadSync = Date.now();
    const unread = { ...this.state.unread }, mentions = { ...this.state.mentions };
    for (const c of remote.channels) {
      this.acked = { ...this.acked, [c.channelId]: Math.max(this.acked[c.channelId] ?? -1, c.lastReadSeq ?? -1) };
      if (c.channelId === this.state.currentChannelId) continue;   // on screen = read, acknowledged below
      if ((this.liveLatest[c.channelId] ?? -1) > (c.latestSeq ?? -1)) continue;   // a live message is newer than this answer
      unread[c.channelId] = c.unread;
      mentions[c.channelId] = c.mentions;
    }
    this.set({ unread, mentions, readSync: true, serverMuted: remote.serverMuted, muted: Object.fromEntries(remote.channels.filter((c) => c.muted).map((c) => [c.channelId, true])) });
    const current = this.state.currentChannelId;
    if (current) this.rememberRead(current, this.state.messages[current]?.list ?? []);
  }

  /**
   * Fallback for servers without read states: fetch the newest page of each text channel that is not on screen and compare it with what this
   * device has read, so channels are marked (and mentions counted) for messages that arrived while we were away or before
   * a reload. The pages also fill the message cache, so opening such a channel needs no request. One channel after the
   * other, to be gentle with the server; a channel we may not read simply gets no mark.
   */
  private async catchUpChannels() {
    const userId = this.state.userId;
    const channels = (this.state.server?.channels ?? []).filter((c) => c.kind === "text").slice(0, CATCH_UP_CHANNELS);
    for (const c of channels) {
      if (c.id === this.state.currentChannelId) continue;
      try {
        const page = await this.api.getMessages(c.id);
        if (!userId || this.state.userId !== userId || this.state.connection !== "connected") return;   // signed out or another user meanwhile
        const cur = this.state.messages[c.id];
        const list = cur?.loaded ? mergeLatest(cur.list, page.messages) : page.messages;
        const messages = { ...this.state.messages, [c.id]: { list, hasMore: cur?.loaded ? cur.hasMore : page.hasMore, loaded: true, loading: cur?.loading ?? false } };
        if (c.id === this.state.currentChannelId) { this.set({ messages }); this.rememberRead(c.id, list); continue; }   // opened while we were fetching
        const result = catchUp(page.messages, this.read[c.id], userId);
        if (this.read[c.id] === undefined) this.rememberRead(c.id, page.messages);   // first sight on this device: start from here
        this.set({
          messages,
          unread: { ...this.state.unread, [c.id]: (this.state.unread[c.id] ?? false) || result.unread },
          // Messages that came in live since the welcome are part of the page too: the larger number is the right one.
          mentions: { ...this.state.mentions, [c.id]: Math.max(this.state.mentions[c.id] ?? 0, result.mentions) },
        });
      } catch { /* not allowed or not reachable: no mark */ }
    }
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
      if (channelId === this.state.currentChannelId) this.rememberRead(channelId, merged);
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

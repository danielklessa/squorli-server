import {
  deriveDmKey, directoryServerUrl, openDm, sealDm,
  type AccountServer, type DirectoryAccount, type DirectoryServerEvent, type DmConversation, type DmMessage, type Friend, type ServerLeaveResponse,
} from "@squorli/protocol";
import * as api from "./api";
import { DirectoryLink, type LinkStatus } from "./directoryLink";
import { loadOrCreateIdentity, storeIdentity, type Identity } from "./identity";
import { ServerConnection, type ServerConnState } from "./serverConnection";
import { t } from "./i18n";
import { loadVoiceSettings, sameSoundSettings, saveVoiceSettings, subscribeVoiceSettings } from "./voice/settings";
import { normalizeSoundSettings, type SoundSettings } from "./voice/sounds";

export type { ChannelMessages, Connection, RawLogEntry, ServerConnState } from "./serverConnection";

/**
 * Client state without a UI dependency (PLAN 3.4). Multi-server client: one `ServerConnection` per server (own server =
 * the one serving the client, key `homeHost`; foreign servers from the server rail via their origin, key =
 * the host from the directory). The server rail switches `activeHost` without leaving the page; running connections
 * (and with them the voice connection) survive. Plus identity, directory (M6), friends and direct messages (M7).
 */

/** Decrypted direct message (M7); text = null if it could not be opened (foreign key, corrupted). */
export type Dm = { id: string; seq: number; from: string; to: string; sentAt: string; text: string | null };
export type DmThread = { list: Dm[]; hasMore: boolean; loaded: boolean; loading: boolean };

export type State = {
  identity: Identity | null;
  /** Key of your own server in `servers` (the host in the address bar). */
  homeHost: string;
  /** The server shown in the main area (server rail). */
  activeHost: string;
  /** State per server; your own server is always present. */
  servers: Record<string, ServerConnState>;
  /** Directory service (M6) named by your own server; null = none. */
  directoryUrl: string | null;
  /** Account at the directory for your own key; undefined = not checked yet, null = not registered. */
  directoryAccount: DirectoryAccount | null | undefined;
  directoryError: string | null;
  /** Servers the handle has signed in on (directory, AccountStatus.servers): the server rail. null = unknown/no account. */
  accountServers: AccountServer[] | null;
  /** Last failure while saving the voice cue settings in the account (settings tab "Sounds"); null = fine. */
  soundSyncError: string | null;
  // ---- M7: friends and direct messages over the directory socket
  /** Connection to the directory socket; "idle" also when there is no directory or no account. */
  directoryLink: LinkStatus;
  directoryLinkError: string | null;
  /** Friends and open requests (from my point of view); null = nothing from the directory yet. */
  friends: Friend[] | null;
  /** Conversations per friend (the friend's key) with unread counts; arrives with the welcome and is kept up to date live. */
  conversations: Record<string, DmConversation>;
  dms: Record<string, DmThread>;
  /** Home view (the Squorli mark in the rail): friends list and direct messages instead of the server columns. */
  homeOpen: boolean;
  currentPeer: string | null;
  /** Last error from a friend or message action (shown inline). */
  friendsError: string | null;
};

/** Sessions per server (the token stays secret); v1 held only the own server's and is migrated once. */
const SESSIONS_KEY = "chat.sessions.v2";
const SESSION_KEY_V1 = "chat.session.v1";
type StoredSessions = { publicKey: string; tokens: Record<string, string> };

export const homeState = (s: State): ServerConnState => s.servers[s.homeHost]!;
export const activeState = (s: State): ServerConnState => s.servers[s.activeHost] ?? homeState(s);

export class Store {
  readonly homeHost = window.location.host;
  state: State;
  private conns = new Map<string, ServerConnection>();
  private link: DirectoryLink | null = null;
  /** Pair key per friend (M7), derived from your own seed and the friend's key; clear it on an identity switch. */
  private dmKeys = new Map<string, Promise<CryptoKey>>();
  private listeners = new Set<(s: State) => void>();
  /** Set by the voice client: a kick/session loss on `host` ends the voice connection if it runs there. */
  onRemoved: ((host: string) => void) | null = null;
  /** Moderation (M3) on `host`: moving to another voice channel (null = out) and stopping camera/screen. */
  onVoiceMoved: ((host: string, channelId: string | null, by: string) => void) | null = null;
  onVoiceStop: ((host: string, what: { camera: boolean; screen: boolean }, by: string) => void) | null = null;
  /** Cue settings as the directory account holds them (null = none there or no account); user changes are pushed when they differ. */
  private accountSounds: SoundSettings | null = null;
  private soundPushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const home = this.createConnection(this.homeHost, "");
    this.state = {
      identity: null, homeHost: this.homeHost, activeHost: this.homeHost, servers: { [this.homeHost]: home.state },
      directoryUrl: null, directoryAccount: undefined, directoryError: null, accountServers: null, soundSyncError: null,
      directoryLink: "idle", directoryLinkError: null, friends: null, conversations: {}, dms: {}, homeOpen: false, currentPeer: null, friendsError: null,
    };
    subscribeVoiceSettings((s, source) => { if (source === "user") this.scheduleSoundPush(s.sounds); });
  }

  subscribe(fn: (s: State) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  private set(p: Partial<State>) { this.state = { ...this.state, ...p }; for (const fn of this.listeners) fn(this.state); }

  /** Connection to a server (your own server is always present). */
  connection(host: string): ServerConnection | null { return this.conns.get(host) ?? null; }
  get home(): ServerConnection { return this.conns.get(this.homeHost)!; }
  get active(): ServerConnection { return this.conns.get(this.state.activeHost) ?? this.home; }

  private createConnection(host: string, base: string): ServerConnection {
    const conn = new ServerConnection(host, base, () => this.state.identity, {
      onState: (s) => { if (this.state) this.set({ servers: { ...this.state.servers, [host]: s } }); },
      onToken: (token) => this.storeToken(host, token),
      onSessionLost: (message) => this.sessionLost(host, message),
      onRemoved: () => this.onRemoved?.(host),
      onConnected: () => { void this.refreshAccountServers(); },
      onVoiceMoved: (channelId, by) => this.onVoiceMoved?.(host, channelId, by),
      onVoiceStop: (what, by) => this.onVoiceStop?.(host, what, by),
    });
    this.conns.set(host, conn);
    return conn;
  }

  async init() {
    const identity = await loadOrCreateIdentity();
    this.set({ identity });
    void this.refreshDirectory();
    const token = this.storedToken(this.homeHost);
    if (token) await this.home.resume(token);
  }

  // ---------- Sessions per server in localStorage
  private readSessions(): StoredSessions | null {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) return JSON.parse(raw) as StoredSessions;
      const v1 = localStorage.getItem(SESSION_KEY_V1);
      if (v1) {
        const s = JSON.parse(v1) as { token: string; publicKey: string };
        const migrated: StoredSessions = { publicKey: s.publicKey, tokens: { [this.homeHost]: s.token } };
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(migrated));
        localStorage.removeItem(SESSION_KEY_V1);
        return migrated;
      }
    } catch { /* no localStorage */ }
    return null;
  }
  private storedToken(host: string): string | null {
    const s = this.readSessions();
    return s && s.publicKey === this.state.identity?.publicKey ? s.tokens[host] ?? null : null;
  }
  private storeToken(host: string, token: string | null) {
    const pk = this.state.identity?.publicKey;
    if (!pk) return;
    try {
      const prev = this.readSessions();
      const tokens = prev && prev.publicKey === pk ? { ...prev.tokens } : {};
      if (token) tokens[host] = token; else delete tokens[host];
      localStorage.setItem(SESSIONS_KEY, JSON.stringify({ publicKey: pk, tokens } satisfies StoredSessions));
    } catch { /* never mind */ }
  }
  private forgetAllTokens() { try { localStorage.removeItem(SESSIONS_KEY); localStorage.removeItem(SESSION_KEY_V1); } catch { /* never mind */ } }

  // ---------- Server rail: switching servers and opening foreign servers
  /** Map a host from the directory (PUBLIC_DOMAIN) onto the key in `servers`: your own server is called `homeHost` here. */
  hostFor(directoryHost: string): string {
    const h = directoryHost.toLowerCase();
    const home = homeState(this.state);
    return h === home.serverDomain || h === this.homeHost.toLowerCase() || h === window.location.hostname.toLowerCase() ? this.homeHost : h;
  }
  /** Show a server in the main area; a foreign server is connected on first use (signing in with your own key). */
  openServer(directoryHost: string) {
    const host = this.hostFor(directoryHost);
    this.set({ activeHost: host, homeOpen: false });
    if (host === this.homeHost) return;
    let conn = this.conns.get(host);
    if (!conn) {
      conn = this.createConnection(host, directoryServerUrl(host));
      this.set({ servers: { ...this.state.servers, [host]: conn.state } });
    }
    const st = conn.state;
    if (st.connection === "idle" && !st.removed) void this.connectForeign(conn);
  }
  /** Try again (after an error or a removal). */
  retryServer(host: string) {
    const conn = this.conns.get(host);
    if (conn && host !== this.homeHost) void this.connectForeign(conn);
  }
  private async connectForeign(conn: ServerConnection) {
    const health = await conn.refreshHealth();
    if (!health) { conn.state = { ...conn.state, connection: "error", error: t("err.serverUnreachableShort", { base: conn.state.base }) }; this.set({ servers: { ...this.state.servers, [conn.state.host]: conn.state } }); return; }
    const token = this.storedToken(conn.state.host);
    if (token && await conn.resume(token)) return;
    try { await conn.login(health.domain.toLowerCase()); } catch { /* the message is kept in the server's state */ }
  }
  /** Close a foreign server and remove it from the client's rail (the session stays stored). */
  closeServer(host: string) {
    if (host === this.homeHost) return;
    const conn = this.conns.get(host);
    conn?.close();
    this.conns.delete(host);
    const servers = { ...this.state.servers }; delete servers[host];
    this.set({ servers, activeHost: this.state.activeHost === host ? this.homeHost : this.state.activeHost });
  }
  /** Session on `host` gone: own server = back to the login (all connections closed), foreign = signed out there only. */
  private sessionLost(host: string, _message: string) {
    if (host !== this.homeHost) return;
    this.closeAllForeign();
  }
  private closeAllForeign() {
    for (const [host, conn] of this.conns) if (host !== this.homeHost) { conn.close(); this.conns.delete(host); }
    this.set({ servers: { [this.homeHost]: this.home.state }, activeHost: this.homeHost });
  }

  /** Fetch the directory URL from your own server and check whether your key has a handle there. */
  async refreshDirectory(): Promise<void> {
    const health = await this.home.refreshHealth();
    const directoryUrl = health?.directoryUrl ?? null;
    this.set({ directoryUrl, directoryError: null });
    const id = this.state.identity;
    if (!directoryUrl || !id) { this.set({ directoryAccount: null }); return; }
    try { this.set({ directoryAccount: await api.directoryLookup(directoryUrl, id.publicKey) }); }
    catch (err) { this.set({ directoryAccount: undefined, directoryError: api.explainDirectoryError(err) }); }
    void this.refreshAccountServers();
    void this.connectDirectory();
  }

  // ---------- M7: directory socket (friends, presence, direct messages)
  /** Open the socket to the directory as soon as directory, account and key are present; otherwise close it. */
  private async connectDirectory() {
    const id = this.state.identity; const url = this.state.directoryUrl;
    this.link?.close(); this.link = null;
    this.dmKeys.clear();
    this.set({ directoryLink: "idle", directoryLinkError: null, friends: null, conversations: {}, dms: {}, homeOpen: false, currentPeer: null });
    if (!id || !url || !this.state.directoryAccount) return;
    const health = await api.directoryHealth(url).catch(() => null);
    if (!health?.features.friends) return;
    const link = new DirectoryLink(url, id, (e) => this.handleDirectory(e), (status, error) => this.set({ directoryLink: status, directoryLinkError: error ?? null }));
    this.link = link;
    link.connect();
  }
  private dmKey(peer: string): Promise<CryptoKey> {
    const id = this.state.identity!;
    let p = this.dmKeys.get(peer);
    if (!p) { p = deriveDmKey(id.privateKey, id.publicKey, peer); this.dmKeys.set(peer, p); }
    return p;
  }
  private async decrypt(m: DmMessage): Promise<Dm> {
    const me = this.state.identity?.publicKey;
    const peer = m.from === me ? m.to : m.from;
    let text: string | null = null;
    try { text = (await openDm(await this.dmKey(peer), m)).text; } catch { text = null; }
    return { id: m.id, seq: m.seq, from: m.from, to: m.to, sentAt: m.sentAt, text };
  }
  private thread(peer: string): DmThread { return this.state.dms[peer] ?? { list: [], hasMore: true, loaded: false, loading: false }; }
  private setThread(peer: string, t: DmThread) { this.set({ dms: { ...this.state.dms, [peer]: t } }); }
  private async handleDirectory(e: DirectoryServerEvent) {
    const me = this.state.identity?.publicKey ?? "";
    switch (e.type) {
      case "welcome": {
        const conversations: Record<string, DmConversation> = {};
        for (const c of e.conversations) conversations[c.peer] = c;
        // After a reconnect, reload the open history; messages could be missing.
        this.set({ friends: e.friends, conversations, dms: {} });
        if (this.state.currentPeer) void this.loadDmHistory(this.state.currentPeer);
        break;
      }
      case "friends.update": {
        const rest = (this.state.friends ?? []).filter((f) => f.publicKey !== e.publicKey);
        this.set({ friends: e.friend ? [...rest, e.friend] : rest });
        break;
      }
      case "friends.presence":
        this.set({ friends: (this.state.friends ?? []).map((f) => (f.publicKey === e.publicKey ? { ...f, online: e.online } : f)) });
        break;
      case "dm.message": {
        const m = e.message;
        const peer = m.from === me ? m.to : m.from;
        const dm = await this.decrypt(m);
        const t = this.thread(peer);
        if (t.loaded && !t.list.some((x) => x.id === dm.id)) this.setThread(peer, { ...t, list: [...t.list, dm].sort((a, b) => a.seq - b.seq) });
        const viewing = this.state.homeOpen && this.state.currentPeer === peer && document.visibilityState === "visible";
        const prev = this.state.conversations[peer];
        const unread = m.from === me || viewing ? 0 : (prev?.unread ?? 0) + 1;
        this.set({ conversations: { ...this.state.conversations, [peer]: { peer, lastSeq: m.seq, lastAt: m.sentAt, unread } } });
        if (viewing && m.from !== me) this.link?.send({ type: "dm.read", peer, seq: m.seq });
        break;
      }
      case "dm.history": {
        const list = await Promise.all(e.messages.map((m) => this.decrypt(m)));
        const t = this.thread(e.peer);
        const known = new Set(t.list.map((m) => m.id));
        const merged = [...list.filter((m) => !known.has(m.id)), ...t.list].sort((a, b) => a.seq - b.seq);
        this.setThread(e.peer, { list: merged, hasMore: t.loaded && merged.length && list.length && list[0]!.seq > merged[0]!.seq ? t.hasMore : e.more, loaded: true, loading: false });
        break;
      }
      case "dm.read": {
        const c = this.state.conversations[e.peer];
        if (c && e.seq >= c.lastSeq) this.set({ conversations: { ...this.state.conversations, [e.peer]: { ...c, unread: 0 } } });
        break;
      }
      case "dm.deleted": {
        const t = this.state.dms[e.peer];
        if (t) this.setThread(e.peer, { ...t, list: t.list.filter((m) => m.id !== e.id) });
        break;
      }
      case "dm.cleared": {
        const conversations = { ...this.state.conversations }; delete conversations[e.peer];
        this.set({ conversations, dms: { ...this.state.dms, [e.peer]: { list: [], hasMore: false, loaded: true, loading: false } } });
        break;
      }
      case "error":
        if (e.code === "version" || e.code === "unauthorized" || e.code === "unknown_account") break; // connection error, recorded in directoryLinkError
        this.set({ friendsError: explainDirectoryCode(e.code) });
        break;
      case "pong": case "challenge":
        break;
    }
  }
  openHome(open = true) { this.set({ homeOpen: open, friendsError: null }); }
  /** Open a conversation with a friend: home view, load the history, report it as read. */
  selectPeer(peer: string) {
    this.set({ homeOpen: true, currentPeer: peer, friendsError: null });
    if (!this.state.dms[peer]?.loaded) void this.loadDmHistory(peer);
    this.markDmRead(peer);
  }
  markDmRead(peer: string) {
    const c = this.state.conversations[peer];
    if (!c || c.unread === 0) return;
    this.set({ conversations: { ...this.state.conversations, [peer]: { ...c, unread: 0 } } });
    this.link?.send({ type: "dm.read", peer, seq: c.lastSeq });
  }
  async loadDmHistory(peer: string, older = false) {
    const t = this.thread(peer);
    if (t.loading || (older && !t.hasMore)) return;
    this.setThread(peer, { ...t, loading: true });
    const before = older ? t.list[0]?.seq : undefined;
    if (!this.link?.send({ type: "dm.history", peer, ...(before !== undefined ? { before } : {}) })) this.setThread(peer, { ...t, loading: false });
  }
  private friendAction(type: "friends.request" | "friends.accept" | "friends.decline" | "friends.remove" | "friends.block" | "friends.unblock", publicKey: string) {
    this.set({ friendsError: null });
    if (!this.link?.send({ type, publicKey })) this.set({ friendsError: "Keine Verbindung zum Verzeichnis." });
  }
  requestFriend(publicKey: string) { this.friendAction("friends.request", publicKey); }
  acceptFriend(publicKey: string) { this.friendAction("friends.accept", publicKey); }
  declineFriend(publicKey: string) { this.friendAction("friends.decline", publicKey); }
  removeFriend(publicKey: string) { this.friendAction("friends.remove", publicKey); }
  blockFriend(publicKey: string) { this.friendAction("friends.block", publicKey); }
  unblockFriend(publicKey: string) { this.friendAction("friends.unblock", publicKey); }
  /** Encrypt and send a direct message; it is displayed via the directory's echo (dm.message). */
  async sendDm(peer: string, text: string) {
    const id = this.state.identity;
    if (!id) return;
    const msgId = crypto.randomUUID();
    const sealed = await sealDm(await this.dmKey(peer), id.publicKey, peer, msgId, { text });
    if (!this.link?.send({ type: "dm.send", to: peer, id: msgId, ...sealed, sentAt: new Date().toISOString() })) throw new Error(t("dir.noLink"));
  }
  deleteDm(peer: string, id: string) { this.link?.send({ type: "dm.delete", peer, id }); }
  clearDm(peer: string) { this.link?.send({ type: "dm.clear", peer }); }
  /** Handle search at the directory (prefix); errors are no big deal here, they just mean no hits. */
  searchHandles(q: string) { const url = this.state.directoryUrl; return url ? api.directorySearchHandles(url, q).catch(() => []) : Promise.resolve([]); }
  /** State of a key in my friends list; null = no entry; undefined = no directory socket. */
  friendState(publicKey: string): Friend["state"] | null | undefined {
    if (!this.state.friends) return undefined;
    return this.state.friends.find((f) => f.publicKey === publicKey)?.state ?? null;
  }

  /** Server rail: fetch the account's server list from the directory (signed). Only with a handle; errors are not a sign-in problem. */
  async refreshAccountServers(): Promise<void> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url || !this.state.directoryAccount) { this.accountSounds = null; this.set({ accountServers: null }); return; }
    try {
      const status = await api.directoryAccountStatus(url, id);
      this.set({ accountServers: status.servers });
      this.adoptAccountSounds(status.soundSettings);
    } catch (err) { console.warn("Serverliste vom Verzeichnis nicht verfuegbar", err); }
  }

  // ---------- Voice cue settings in the account: the per-device copy in localStorage (voice/settings.ts) stays the working
  // copy, so servers without a directory keep working; with an account the account's copy wins on load and every user
  // change is pushed there (signed, coalesced for slider drags).
  /** Account status arrived: take the account's cue settings over on this device, or seed the account with the local ones if it has none yet. */
  private adoptAccountSounds(remote: SoundSettings | null): void {
    const local = loadVoiceSettings();
    if (!remote) { this.accountSounds = null; this.scheduleSoundPush(local.sounds, 0); return; }
    const sounds = normalizeSoundSettings(remote);
    this.accountSounds = sounds;
    if (!sameSoundSettings(local.sounds, sounds)) saveVoiceSettings({ ...local, sounds }, "directory");
  }
  private scheduleSoundPush(sounds: SoundSettings, delayMs = 800): void {
    if (!this.state.identity || !this.state.directoryUrl || !this.state.directoryAccount) return;
    if (this.accountSounds && sameSoundSettings(this.accountSounds, sounds)) return;
    if (this.soundPushTimer) clearTimeout(this.soundPushTimer);
    this.soundPushTimer = setTimeout(() => { this.soundPushTimer = null; void this.pushSounds(); }, delayMs);
  }
  private async pushSounds(): Promise<void> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url || !this.state.directoryAccount) return;
    const sounds = loadVoiceSettings().sounds;
    if (this.accountSounds && sameSoundSettings(this.accountSounds, sounds)) return;
    try {
      await api.directorySetSoundSettings(url, id, sounds);
      this.accountSounds = sounds;
      if (this.state.soundSyncError) this.set({ soundSyncError: null });
    } catch (err) { this.set({ soundSyncError: api.explainDirectoryError(err) }); }
  }

  /** Register a handle at the directory (M6a). */
  async registerHandle(handle: string): Promise<boolean> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url) return false;
    this.set({ directoryError: null });
    try {
      const account = await api.directoryRegister(url, id, handle);
      this.set({ directoryAccount: account });
      return true;
    } catch (err) {
      this.set({ directoryError: api.explainDirectoryError(err) });
      return false;
    }
  }

  /**
   * M6b: sign-in with handle + password. Fetches the key from the directory, replaces the device key, then signs in normally.
   * M6c: with an active authenticator the first attempt throws `totp_required`; the login screen then asks for the code.
   */
  async loginWithHandle(handle: string, password: string, invite?: string, code?: string): Promise<void> {
    const url = this.state.directoryUrl;
    if (!url) return;
    const home = this.home;
    home.state = { ...home.state, connection: "logging-in", error: null, removed: null };
    this.set({ servers: { ...this.state.servers, [this.homeHost]: home.state } });
    let id: Identity;
    try { id = await api.directoryRestore(url, handle, password, code); }
    catch (err) {
      const errCode = err instanceof api.ApiError ? err.code : null;
      // totp_required is not an error but the next step: keep the message neutral.
      home.state = { ...home.state, connection: errCode === "totp_required" ? "idle" : "error", error: api.explainDirectoryError(err) };
      this.set({ servers: { ...this.state.servers, [this.homeHost]: home.state } });
      throw Object.assign(new Error("restore failed"), { code: errCode });
    }
    this.closeAllForeign();
    home.close();
    home.api.setToken(null);
    this.forgetAllTokens();
    storeIdentity(id);
    this.set({ identity: id, directoryAccount: undefined });
    void this.refreshDirectory();
    await this.login(invite);
  }

  /** Set the display name in the directory (server = null: global, otherwise this server); throws on errors (message translated). */
  async setDirectoryName(server: string | null, displayName: string | null): Promise<void> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url) throw new Error(t("dir.none"));
    try { await api.directorySetDisplayName(url, id, server, displayName); }
    catch (err) { throw new Error(api.explainDirectoryError(err)); }
    const acc = this.state.directoryAccount;
    if (acc && server === null) this.set({ directoryAccount: { ...acc, displayName } });
  }

  /**
   * Delete your account on a chat server (rail context menu): the signed request goes to the directory, which notifies the
   * server. If it confirmed (`delivered`), the own server has already closed our socket with 4012 (login screen with a message);
   * a foreign server is closed here and its session forgotten. Throws with a translated message.
   */
  async leaveServer(directoryHost: string): Promise<ServerLeaveResponse> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url) throw new Error(t("dir.none"));
    let r: ServerLeaveResponse;
    try { r = await api.directoryLeaveServer(url, id, directoryHost); }
    catch (err) { throw new Error(api.explainDirectoryError(err)); }
    if (r.delivered) {
      const key = this.hostFor(directoryHost);
      if (key === this.homeHost) this.home.accountDeleted();
      else { this.closeServer(key); this.storeToken(key, null); }
    }
    void this.refreshAccountServers();
    return r;
  }

  /** M6b: store a password backup of the device key at the directory. */
  async createBackup(password: string): Promise<boolean> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url) return false;
    this.set({ directoryError: null });
    try {
      await api.directoryBackupUpload(url, id, password);
      const acc = this.state.directoryAccount;
      if (acc) this.set({ directoryAccount: { ...acc, hasBackup: true } });
      return true;
    } catch (err) {
      this.set({ directoryError: api.explainDirectoryError(err) });
      return false;
    }
  }

  /** Sign in on your own server (signature over the hostname in the address bar = PUBLIC_DOMAIN), optionally with an invite. */
  async login(invite?: string): Promise<void> {
    await this.home.login(window.location.hostname, invite);
  }

  /** Sign out: all servers (the client hangs off your own server's session). */
  logout() {
    this.closeAllForeign();
    this.home.logout();
  }

  async forgetIdentity() {
    this.logout();
    this.link?.close(); this.link = null;
    this.forgetAllTokens();
    const { forgetIdentity } = await import("./identity");
    forgetIdentity();
    this.set({ identity: await loadOrCreateIdentity(), directoryAccount: undefined });
    void this.refreshDirectory();
  }
}

/** Turns error codes from the directory socket (M7) into sentences. */
function explainDirectoryCode(code: string): string {
  switch (code) {
    case "self": case "unknown_account": case "not_friends": case "blocked": case "declined_recently": case "rate_limited": case "too_large": case "duplicate": case "not_found":
      return t(`dirws.${code}`);
    default: return t("dirws.default", { code });
  }
}

import { PROTOCOL_VERSION, ServerEvent, type AccountServer, type ClientEvent, type DirectoryAccount, type Me, type Message, type ServerState, type VoiceMember } from "@squorli/protocol";
import * as api from "./api";
import { loadOrCreateIdentity, storeIdentity, type Identity } from "./identity";

/**
 * Client-Zustand ohne UI-Abhaengigkeit (PLAN 3.4): Sitzung, Serverzustand, Nachrichten-Cache,
 * Sprachkanal-Praesenz, Tipp-Anzeige, WebSocket mit Wiederverbindung.
 */
export type Connection = "idle" | "logging-in" | "connecting" | "connected" | "reconnecting" | "error";

export type ChannelMessages = { list: Message[]; hasMore: boolean; loaded: boolean; loading: boolean };

export type RawLogEntry = { dir: "in" | "out"; at: number; text: string };

export type State = {
  identity: Identity | null;
  me: Me | null;
  userId: string | null;
  connection: Connection;
  error: string | null;
  /** Server hat uns entfernt; Login erst nach Nutzeraktion erneut. */
  removed: { reason: "kicked" | "banned"; message: string | null } | null;
  server: ServerState | null;
  voice: Record<string, VoiceMember[]>;
  messages: Record<string, ChannelMessages>;
  /** channelId -> userId -> Zeitstempel des letzten Tippens */
  typing: Record<string, Record<string, number>>;
  currentChannelId: string | null;
  /** Kanal mit ungelesenen Nachrichten (seit letztem Ansehen). */
  unread: Record<string, boolean>;
  log: RawLogEntry[];
  /** Verzeichnisdienst (M6), den dieser Server nennt; null = keiner. */
  directoryUrl: string | null;
  /** Konto beim Verzeichnis fuer den eigenen Schluessel; undefined = noch nicht geprueft, null = nicht registriert. */
  directoryAccount: DirectoryAccount | null | undefined;
  directoryError: string | null;
  /** Servername und Icon aus /api/health, fuer Seitentitel und Favicon schon vor dem Login. */
  serverName: string | null;
  iconUrl: string | null;
  /** PUBLIC_DOMAIN dieses Servers (aus /api/health): Schluessel des Anzeigenamens je Server im Verzeichnis. */
  serverDomain: string | null;
  /** Anmeldung nur mit Verzeichniskonto (aus /api/health); der Login sperrt dann den reinen Browser-Schluessel. */
  requireAccount: boolean;
  /** Serverversion aus /api/health fuer den Squorli-Hinweis im Login. */
  serverVersion: string | null;
  /** Server, auf denen sich das Handle angemeldet hat (Verzeichnis, AccountStatus.servers): Server-Leiste. null = unbekannt/kein Konto. */
  accountServers: AccountServer[] | null;
};

const SESSION_KEY = "chat.session.v1";
const LOG_MAX = 80;
const EMPTY: ChannelMessages = { list: [], hasMore: true, loaded: false, loading: false };

export class Store {
  state: State = {
    identity: null, me: null, userId: null, connection: "idle", error: null, removed: null, server: null,
    voice: {}, messages: {}, typing: {}, currentChannelId: null, unread: {}, log: [],
    directoryUrl: null, directoryAccount: undefined, directoryError: null, serverName: null, iconUrl: null, serverDomain: null,
    requireAccount: false, serverVersion: null, accountServers: null,
  };
  private listeners = new Set<(s: State) => void>();
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private wantConnection = false;
  private pingTimer: number | null = null;
  /** Wird vom Sprach-Client gesetzt, damit ein Kick die Sprachverbindung beendet. */
  onRemoved: (() => void) | null = null;
  /** Moderation (M3): Verschieben in einen anderen Sprachkanal (null = raus) und Beenden von Kamera/Bildschirm. */
  onVoiceMoved: ((channelId: string | null, by: string) => void) | null = null;
  onVoiceStop: ((what: { camera: boolean; screen: boolean }, by: string) => void) | null = null;

  subscribe(fn: (s: State) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  private set(p: Partial<State>) { this.state = { ...this.state, ...p }; for (const fn of this.listeners) fn(this.state); }

  async init() {
    const identity = await loadOrCreateIdentity();
    this.set({ identity });
    // Token vom Server abgelehnt (abgelaufen, von einem anderen Geraet abgemeldet): zurueck zum Login, nicht mit totem Token weiterlaufen.
    api.onUnauthorized(() => { if (this.state.me) this.sessionLost("Die Sitzung ist abgelaufen oder wurde abgemeldet. Bitte erneut anmelden."); });
    void this.refreshDirectory();
    // Gespeicherte Sitzung wiederverwenden, wenn sie noch gilt.
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { token: string; publicKey: string };
        if (s.publicKey === identity.publicKey) {
          api.setToken(s.token);
          const me = await api.getMe().catch(() => null);
          if (me) { this.set({ me, userId: me.userId }); this.connect(); return; }
          api.setToken(null);
        }
      }
    } catch { /* kein localStorage */ }
  }

  /** Verzeichnis-URL vom Server holen und nachsehen, ob der eigene Schluessel dort ein Handle hat. */
  async refreshDirectory(): Promise<void> {
    const health = await api.getHealth().catch(() => null);
    const directoryUrl = health?.directoryUrl ?? null;
    this.set({
      directoryUrl, directoryError: null, serverName: health?.serverName ?? null, iconUrl: health?.iconUrl ?? null, serverDomain: health?.domain?.toLowerCase() ?? null,
      requireAccount: !!directoryUrl && health?.requireAccount === true, serverVersion: health?.version ?? null,
    });
    const id = this.state.identity;
    if (!directoryUrl || !id) { this.set({ directoryAccount: null }); return; }
    try { this.set({ directoryAccount: await api.directoryLookup(directoryUrl, id.publicKey) }); }
    catch (err) { this.set({ directoryAccount: undefined, directoryError: api.explainDirectoryError(err) }); }
    void this.refreshAccountServers();
  }

  /** Server-Leiste: Serverliste des Kontos beim Verzeichnis holen (signiert). Nur mit Handle; Fehler sind kein Login-Problem. */
  async refreshAccountServers(): Promise<void> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url || !this.state.directoryAccount) { this.set({ accountServers: null }); return; }
    try { this.set({ accountServers: (await api.directoryAccountStatus(url, id)).servers }); }
    catch (err) { console.warn("Serverliste vom Verzeichnis nicht verfuegbar", err); }
  }

  /** Handle beim Verzeichnis registrieren (M6a). */
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
   * M6b: Anmeldung mit Handle + Passwort. Holt den Schluessel vom Verzeichnis, ersetzt den Geraeteschluessel, meldet dann normal an.
   * M6c: bei aktivem Authenticator wirft der erste Versuch `totp_required`; der Login-Bildschirm fragt dann den Code ab.
   */
  async loginWithHandle(handle: string, password: string, invite?: string, code?: string): Promise<void> {
    const url = this.state.directoryUrl;
    if (!url) return;
    this.set({ connection: "logging-in", error: null, removed: null });
    let id: Identity;
    try { id = await api.directoryRestore(url, handle, password, code); }
    catch (err) {
      const errCode = err instanceof api.ApiError ? err.code : null;
      // totp_required ist kein Fehler, sondern der naechste Schritt: Meldung neutral halten.
      this.set({ connection: errCode === "totp_required" ? "idle" : "error", error: api.explainDirectoryError(err) });
      throw Object.assign(new Error("restore failed"), { code: errCode });
    }
    this.wantConnection = false;
    this.ws?.close();
    api.setToken(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* egal */ }
    storeIdentity(id);
    this.set({ identity: id, directoryAccount: undefined, connection: "idle" });
    void this.refreshDirectory();
    await this.login(invite);
  }

  /** Anzeigename im Verzeichnis setzen (server = null: global, sonst dieser Server); wirft bei Fehlern (Meldung uebersetzt). */
  async setDirectoryName(server: string | null, displayName: string | null): Promise<void> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url) throw new Error("Kein Verzeichnis.");
    try { await api.directorySetDisplayName(url, id, server, displayName); }
    catch (err) { throw new Error(api.explainDirectoryError(err)); }
    const acc = this.state.directoryAccount;
    if (acc && server === null) this.set({ directoryAccount: { ...acc, displayName } });
  }

  /** M6b: Passwort-Backup fuer den Geraeteschluessel beim Verzeichnis ablegen. */
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

  /** Anmelden (Challenge-Response), optional mit Einladung, dann WebSocket verbinden. */
  async login(invite?: string): Promise<void> {
    const id = this.state.identity;
    if (!id) return;
    this.set({ connection: "logging-in", error: null, removed: null });
    try {
      const session = await api.login(id, invite);
      api.setToken(session.sessionToken);
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token: session.sessionToken, publicKey: id.publicKey })); } catch { /* egal */ }
      const me = await api.getMe();
      this.set({ me, userId: me.userId });
      this.connect();
    } catch (err) {
      const code = err instanceof api.ApiError ? err.code : null;
      this.set({ connection: "error", error: await api.explainLoginError(err) });
      throw Object.assign(new Error("login failed"), { code });
    }
  }

  logout() {
    // Sitzung auch serverseitig beenden (M6c), damit sie nicht in der Geraeteliste anderer Browser bleibt; best effort.
    if (api.getToken()) void api.logoutSession().catch(() => {});
    this.clearSession(null);
  }

  /** Sitzung vom Server verloren (Fernabmeldung, abgelaufen): wie Abmelden, aber mit Meldung im Login und Sprache verlassen. */
  private sessionLost(message: string) {
    this.onRemoved?.();
    this.clearSession(message);
  }

  private clearSession(error: string | null) {
    this.wantConnection = false;
    this.ws?.close();
    api.setToken(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* egal */ }
    this.set({ me: null, userId: null, connection: "idle", server: null, messages: {}, voice: {}, currentChannelId: null, removed: null, error });
  }

  async forgetIdentity() {
    this.logout();
    const { forgetIdentity } = await import("./identity");
    forgetIdentity();
    this.set({ identity: await loadOrCreateIdentity(), directoryAccount: undefined });
    void this.refreshDirectory();
  }

  // ---------- WebSocket
  private connect() {
    this.wantConnection = true;
    const token = api.getToken();
    if (!token) return;
    this.set({ connection: this.state.server ? "reconnecting" : "connecting" });
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
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
      // 4011 = Sitzung von einem anderen Geraet abgemeldet (M6c): nicht wiederverbinden, zurueck zum Login.
      if (ev.code === 4011 && this.wantConnection) return this.sessionLost("Diese Sitzung wurde von einem anderen Gerät abgemeldet.");
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
        if (!wasReconnect) void this.refreshAccountServers();
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.send({ type: "ping", t: Date.now() }), 20_000);
        // Nach Wiederverbindung: Verlauf des aktuellen Kanals neu laden, es koennten Nachrichten fehlen.
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
        this.onVoiceMoved?.(e.channelId, e.by);
        break;
      case "voice.stop":
        this.onVoiceStop?.({ camera: e.camera, screen: e.screen }, e.by);
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
        this.onRemoved?.();
        this.set({ removed: { reason: e.reason, message: e.message }, connection: "idle", server: null, messages: {}, voice: {} });
        break;
      case "error":
        if (e.code === "unauthorized") {
          // Token ungueltig oder keine Mitgliedschaft mehr: nicht mit totem Socket im Chat bleiben.
          this.sessionLost(e.message === "not a member" ? "Du bist auf diesem Server kein Mitglied mehr." : "Die Sitzung ist ungültig. Bitte erneut anmelden.");
        } else if (e.code === "protocol_version") {
          this.wantConnection = false;
          this.set({ connection: "error", error: `${e.code}: ${e.message}` });
        }
        break;
      case "pong":
        break;
    }
  }

  // ---------- Kanaele und Nachrichten
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
      const page = await api.getMessages(channelId, before);
      const cur = this.state.messages[channelId] ?? EMPTY;
      const merged = older ? [...page.messages, ...cur.list] : mergeLatest(cur.list, page.messages);
      this.set({ messages: { ...this.state.messages, [channelId]: { list: merged, hasMore: older ? page.hasMore : (cur.loaded ? cur.hasMore : page.hasMore), loaded: true, loading: false } } });
    } catch (err) {
      this.set({ messages: { ...this.state.messages, [channelId]: { ...ch, loading: false } }, error: String(err) });
    }
  }

  async sendMessage(channelId: string, content: string, files: File[]) {
    const attachmentIds: string[] = [];
    for (const f of files) attachmentIds.push((await api.uploadAttachment(f)).id);
    const msg = await api.sendMessage(channelId, content, attachmentIds);
    const ch = this.state.messages[channelId];
    if (ch?.loaded && !ch.list.some((m) => m.id === msg.id)) {
      this.set({ messages: { ...this.state.messages, [channelId]: { ...ch, list: [...ch.list, msg] } } });
    }
  }

  typing(channelId: string) { this.send({ type: "typing", channelId }); }

  clearError() { this.set({ error: null }); }
}

/** Neueste Seite mit vorhandenem Cache zusammenfuehren (nach Reconnect), ohne Dubletten. */
function mergeLatest(cur: Message[], page: Message[]): Message[] {
  if (!cur.length) return page;
  const known = new Set(cur.map((m) => m.id));
  const byId = new Map(page.map((m) => [m.id, m]));
  const updated = cur.map((m) => byId.get(m.id) ?? m);
  return [...updated, ...page.filter((m) => !known.has(m.id))].sort((a, b) => a.seq - b.seq);
}

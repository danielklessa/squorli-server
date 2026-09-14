import {
  deriveDmKey, directoryServerUrl, openDm, sealDm,
  type AccountServer, type DirectoryAccount, type DirectoryServerEvent, type DmConversation, type DmMessage, type Friend,
} from "@squorli/protocol";
import * as api from "./api";
import { DirectoryLink, type LinkStatus } from "./directoryLink";
import { loadOrCreateIdentity, storeIdentity, type Identity } from "./identity";
import { ServerConnection, type ServerConnState } from "./serverConnection";

export type { ChannelMessages, Connection, RawLogEntry, ServerConnState } from "./serverConnection";

/**
 * Client-Zustand ohne UI-Abhaengigkeit (PLAN 3.4). Multi-Server-Client: eine `ServerConnection` je Server (eigener Server =
 * der, der den Client ausliefert, Schluessel `homeHost`; fremde Server aus der Server-Leiste ueber ihre Origin, Schluessel =
 * Host aus dem Verzeichnis). Die Server-Leiste wechselt `activeHost`, ohne die Seite zu verlassen; laufende Verbindungen
 * (und damit die Sprachverbindung) bleiben bestehen. Dazu Identitaet, Verzeichnis (M6), Freunde und Direktnachrichten (M7).
 */

/** Entschluesselte Direktnachricht (M7); text = null, wenn sie sich nicht oeffnen liess (fremder Schluessel, beschaedigt). */
export type Dm = { id: string; seq: number; from: string; to: string; sentAt: string; text: string | null };
export type DmThread = { list: Dm[]; hasMore: boolean; loaded: boolean; loading: boolean };

export type State = {
  identity: Identity | null;
  /** Schluessel des eigenen Servers in `servers` (Host der Adressleiste). */
  homeHost: string;
  /** Server, der im Hauptbereich gezeigt wird (Server-Leiste). */
  activeHost: string;
  /** Zustand je Server; der eigene Server ist immer vorhanden. */
  servers: Record<string, ServerConnState>;
  /** Verzeichnisdienst (M6), den der eigene Server nennt; null = keiner. */
  directoryUrl: string | null;
  /** Konto beim Verzeichnis fuer den eigenen Schluessel; undefined = noch nicht geprueft, null = nicht registriert. */
  directoryAccount: DirectoryAccount | null | undefined;
  directoryError: string | null;
  /** Server, auf denen sich das Handle angemeldet hat (Verzeichnis, AccountStatus.servers): Server-Leiste. null = unbekannt/kein Konto. */
  accountServers: AccountServer[] | null;
  // ---- M7: Freunde und Direktnachrichten ueber den Verzeichnis-Socket
  /** Verbindung zum Verzeichnis-Socket; "idle" auch ohne Verzeichnis oder ohne Konto. */
  directoryLink: LinkStatus;
  directoryLinkError: string | null;
  /** Freunde und offene Anfragen (aus meiner Sicht); null = noch nichts vom Verzeichnis. */
  friends: Friend[] | null;
  /** Gespraeche je Freund (Schluessel des Freundes) mit Ungelesenem; kommt mit dem welcome und wird live nachgefuehrt. */
  conversations: Record<string, DmConversation>;
  dms: Record<string, DmThread>;
  /** Startansicht (Squorli-Symbol in der Leiste): Freundesliste und Direktnachrichten statt der Server-Spalten. */
  homeOpen: boolean;
  currentPeer: string | null;
  /** Letzter Fehler einer Freundes- oder Nachrichtenaktion (inline anzeigen). */
  friendsError: string | null;
};

/** Sitzungen je Server (Token bleibt geheim); v1 hielt nur die des eigenen Servers und wird einmalig uebernommen. */
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
  /** Paarschluessel je Freund (M7), abgeleitet aus dem eigenen Seed und dem Schluessel des Freundes; bei Identitaetswechsel leeren. */
  private dmKeys = new Map<string, Promise<CryptoKey>>();
  private listeners = new Set<(s: State) => void>();
  /** Wird vom Sprach-Client gesetzt: Kick/Sitzungsverlust auf `host` beendet die Sprachverbindung, falls sie dort laeuft. */
  onRemoved: ((host: string) => void) | null = null;
  /** Moderation (M3) auf `host`: Verschieben in einen anderen Sprachkanal (null = raus) und Beenden von Kamera/Bildschirm. */
  onVoiceMoved: ((host: string, channelId: string | null, by: string) => void) | null = null;
  onVoiceStop: ((host: string, what: { camera: boolean; screen: boolean }, by: string) => void) | null = null;

  constructor() {
    const home = this.createConnection(this.homeHost, "");
    this.state = {
      identity: null, homeHost: this.homeHost, activeHost: this.homeHost, servers: { [this.homeHost]: home.state },
      directoryUrl: null, directoryAccount: undefined, directoryError: null, accountServers: null,
      directoryLink: "idle", directoryLinkError: null, friends: null, conversations: {}, dms: {}, homeOpen: false, currentPeer: null, friendsError: null,
    };
  }

  subscribe(fn: (s: State) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  private set(p: Partial<State>) { this.state = { ...this.state, ...p }; for (const fn of this.listeners) fn(this.state); }

  /** Verbindung zu einem Server (eigener Server immer vorhanden). */
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

  // ---------- Sitzungen je Server im localStorage
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
    } catch { /* kein localStorage */ }
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
    } catch { /* egal */ }
  }
  private forgetAllTokens() { try { localStorage.removeItem(SESSIONS_KEY); localStorage.removeItem(SESSION_KEY_V1); } catch { /* egal */ } }

  // ---------- Server-Leiste: Server wechseln und fremde Server oeffnen
  /** Host aus dem Verzeichnis (PUBLIC_DOMAIN) auf den Schluessel in `servers` abbilden: der eigene Server heisst hier `homeHost`. */
  hostFor(directoryHost: string): string {
    const h = directoryHost.toLowerCase();
    const home = homeState(this.state);
    return h === home.serverDomain || h === this.homeHost.toLowerCase() || h === window.location.hostname.toLowerCase() ? this.homeHost : h;
  }
  /** Server im Hauptbereich zeigen; ein fremder Server wird beim ersten Mal verbunden (Anmeldung mit dem eigenen Schluessel). */
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
  /** Erneut versuchen (nach Fehler oder Entfernung). */
  retryServer(host: string) {
    const conn = this.conns.get(host);
    if (conn && host !== this.homeHost) void this.connectForeign(conn);
  }
  private async connectForeign(conn: ServerConnection) {
    const health = await conn.refreshHealth();
    if (!health) { conn.state = { ...conn.state, connection: "error", error: `Der Server ${conn.state.base} ist nicht erreichbar oder erlaubt keinen Zugriff aus anderen Clients.` }; this.set({ servers: { ...this.state.servers, [conn.state.host]: conn.state } }); return; }
    const token = this.storedToken(conn.state.host);
    if (token && await conn.resume(token)) return;
    try { await conn.login(health.domain.toLowerCase()); } catch { /* Meldung steht im Zustand des Servers */ }
  }
  /** Fremden Server schliessen und aus der Leiste des Clients nehmen (Sitzung bleibt gespeichert). */
  closeServer(host: string) {
    if (host === this.homeHost) return;
    const conn = this.conns.get(host);
    conn?.close();
    this.conns.delete(host);
    const servers = { ...this.state.servers }; delete servers[host];
    this.set({ servers, activeHost: this.state.activeHost === host ? this.homeHost : this.state.activeHost });
  }
  /** Sitzung auf `host` weg: eigener Server = zurueck zum Login (alle Verbindungen zu), fremder = nur dort abgemeldet. */
  private sessionLost(host: string, _message: string) {
    if (host !== this.homeHost) return;
    this.closeAllForeign();
  }
  private closeAllForeign() {
    for (const [host, conn] of this.conns) if (host !== this.homeHost) { conn.close(); this.conns.delete(host); }
    this.set({ servers: { [this.homeHost]: this.home.state }, activeHost: this.homeHost });
  }

  /** Verzeichnis-URL vom eigenen Server holen und nachsehen, ob der eigene Schluessel dort ein Handle hat. */
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

  // ---------- M7: Verzeichnis-Socket (Freunde, Praesenz, Direktnachrichten)
  /** Socket zum Verzeichnis aufbauen, sobald Verzeichnis, Konto und Schluessel da sind; sonst schliessen. */
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
        // Nach einer Wiederverbindung den offenen Verlauf neu laden, es koennten Nachrichten fehlen.
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
        if (e.code === "version" || e.code === "unauthorized" || e.code === "unknown_account") break; // Verbindungsfehler, steht in directoryLinkError
        this.set({ friendsError: explainDirectoryCode(e.code) });
        break;
      case "pong": case "challenge":
        break;
    }
  }
  openHome(open = true) { this.set({ homeOpen: open, friendsError: null }); }
  /** Gespraech mit einem Freund oeffnen: Startansicht, Verlauf laden, als gelesen melden. */
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
  /** Direktnachricht verschluesseln und senden; die Anzeige kommt ueber das Echo des Verzeichnisses (dm.message). */
  async sendDm(peer: string, text: string) {
    const id = this.state.identity;
    if (!id) return;
    const msgId = crypto.randomUUID();
    const sealed = await sealDm(await this.dmKey(peer), id.publicKey, peer, msgId, { text });
    if (!this.link?.send({ type: "dm.send", to: peer, id: msgId, ...sealed, sentAt: new Date().toISOString() })) throw new Error("Keine Verbindung zum Verzeichnis.");
  }
  deleteDm(peer: string, id: string) { this.link?.send({ type: "dm.delete", peer, id }); }
  clearDm(peer: string) { this.link?.send({ type: "dm.clear", peer }); }
  /** Handle-Suche beim Verzeichnis (Praefix); Fehler sind hier kein Drama, dann eben keine Treffer. */
  searchHandles(q: string) { const url = this.state.directoryUrl; return url ? api.directorySearchHandles(url, q).catch(() => []) : Promise.resolve([]); }
  /** Zustand eines Schluessels in meiner Freundesliste; null = kein Eintrag; undefined = kein Verzeichnis-Socket. */
  friendState(publicKey: string): Friend["state"] | null | undefined {
    if (!this.state.friends) return undefined;
    return this.state.friends.find((f) => f.publicKey === publicKey)?.state ?? null;
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
    const home = this.home;
    home.state = { ...home.state, connection: "logging-in", error: null, removed: null };
    this.set({ servers: { ...this.state.servers, [this.homeHost]: home.state } });
    let id: Identity;
    try { id = await api.directoryRestore(url, handle, password, code); }
    catch (err) {
      const errCode = err instanceof api.ApiError ? err.code : null;
      // totp_required ist kein Fehler, sondern der naechste Schritt: Meldung neutral halten.
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

  /** Am eigenen Server anmelden (Signatur ueber den Hostnamen der Adressleiste = PUBLIC_DOMAIN), optional mit Einladung. */
  async login(invite?: string): Promise<void> {
    await this.home.login(window.location.hostname, invite);
  }

  /** Abmelden: alle Server (der Client haengt an der Sitzung des eigenen Servers). */
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

/** Fehlercodes des Verzeichnis-Sockets (M7) in Saetze. */
function explainDirectoryCode(code: string): string {
  switch (code) {
    case "self": return "Das bist du selbst.";
    case "unknown_account": return "Dieses Konto gibt es beim Verzeichnis nicht.";
    case "not_friends": return "Ihr seid keine Freunde; Nachrichten gehen nur an bestätigte Freunde.";
    case "blocked": return "Diese Person hat dich blockiert, oder du sie.";
    case "declined_recently": return "Die Anfrage wurde vor Kurzem abgelehnt; bitte später noch einmal.";
    case "rate_limited": return "Zu viele Aktionen, bitte kurz warten.";
    case "too_large": return "Die Nachricht ist zu groß.";
    case "duplicate": return "Diese Nachricht wurde schon gesendet.";
    case "not_found": return "Nicht gefunden.";
    default: return `Verzeichnis: ${code}`;
  }
}

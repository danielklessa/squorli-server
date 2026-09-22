import {
  DM_MAX_CIPHERTEXT_CHARS, base64ToBytes, deriveDmKey, deriveSettingsKey, directoryServerUrl, openDm, openSettings, sealDm, sealSettings, type DmControl, type DmPreview,
  type AccountServer, type AccountSettings, type AccountStatus, type DirectoryAccount, type DirectoryServerEvent, type DmConversation, type DmMessage, type Friend, type GamePresence, type ServerLeaveResponse,
} from "@squorli/protocol";
import { buildDmPreviews, type PreviewDeps } from "./dmPreviews";
import { shrinkPreviewImage } from "./dmPreviewImage";
import { activity } from "./activity";
import { chooseInitialServer, loadClientData, parseServerAddress, saveClientData } from "./clientHome";
import * as api from "./api";
import type { AvatarImage } from "./avatarImage";
import { DirectoryLink, type LinkStatus } from "./directoryLink";
import { loadOrCreateIdentity, storeIdentity, type Identity } from "./identity";
import { ServerConnection, type ServerConnState } from "./serverConnection";
import { applyAccountSettings, sameAccountSettings, sameHiddenGames, toAccountSettings } from "./accountSettings";
import { seesIncoming } from "./attention";
import { accountLocalePreference, detectLocale, locale, localePreference, markAccountLocalePreference, storeLocalePreference, t, type LocalePreference } from "./i18n";
import { loadVoiceSettings, sameSoundSettings, saveVoiceSettings, subscribeVoiceSettings } from "./voice/settings";
import { normalizeSoundSettings } from "./voice/sounds";
import { platform } from "./platform";
import type { PlatformHome } from "./platform/types";

export type { ChannelMessages, Connection, RawLogEntry, ServerConnState } from "./serverConnection";

/**
 * Client state without a UI dependency (PLAN 3.4). Multi-server client: one `ServerConnection` per server (own server =
 * the one serving the client, key `homeHost`; foreign servers from the server rail via their origin, key =
 * the host from the directory). The server rail switches `activeHost` without leaving the page; running connections
 * (and with them the voice connection) survive. Plus identity, directory (M6), friends and direct messages (M7).
 *
 * A client without a home server (the desktop app, docs/features/desktop.md): `homeHost` is null, the directory is the
 * platform's default, the client has a login of its own (`signedIn`) and every server is a "foreign" one: the account's
 * servers from the directory plus the ones added by address (`localHosts`).
 */

/** Decrypted direct message (M7); text = null if it could not be opened (foreign key, corrupted). */
/** `previews` = what the sender put into the message; `control` = the message is an instruction (dmPreviews.ts `visibleDms`), not text. */
export type Dm = { id: string; seq: number; from: string; to: string; sentAt: string; text: string | null; previews?: DmPreview[]; control?: DmControl };
export type DmThread = { list: Dm[]; hasMore: boolean; loaded: boolean; loading: boolean };

export type State = {
  identity: Identity | null;
  /** Key of your own server in `servers` (the host in the address bar); null = the client has no home server (desktop app). */
  homeHost: string | null;
  /** The server shown in the main area (server rail); null = none (only without a home server). */
  activeHost: string | null;
  /** State per server; your own server is always present when the client has one. */
  servers: Record<string, ServerConnState>;
  /** Directory service (M6) named by your own server; null = none. */
  directoryUrl: string | null;
  /** Account at the directory for your own key; undefined = not checked yet, null = not registered. */
  directoryAccount: DirectoryAccount | null | undefined;
  directoryError: string | null;
  /** The directory wants a confirmed e-mail address for a new handle (its `features.emailRequired`); asked only while the key has no handle. */
  directoryEmailRequired: boolean;
  /** The directory stores avatars (`features.avatars`): the settings offer the upload. False until the signed status was read. */
  directoryAvatars: boolean;
  /** The directory has a game library (`GET /api/games/:id`, docs/features/games.md): names and icons of launcher game ids. */
  directoryGameLibrary: boolean;
  /** Servers the handle has signed in on (directory, AccountStatus.servers): the server rail. null = unknown/no account. */
  accountServers: AccountServer[] | null;
  /** Last failure while saving the settings in the directory account (shown in the settings dialog); null = fine. */
  settingsSyncError: string | null;
  /** The account keeps the settings as a blob only this user's key opens (directory `features.settingsSealed`); false = in the open, or no account. */
  settingsSealed: boolean;
  /** The games never to show, as the account's sealed settings hold them (App.tsx hands them to the game detection); null = the account says nothing. */
  accountHiddenGames: string[] | null;
  /** A language change is stored but waits for the reload until the voice connection has ended (`reloadForLocale`). */
  localeReloadPending: boolean;
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
  /**
   * The client is still finding out what its first screen is (`init()`: the key, and without a home server the directory
   * account with its servers). Until then App.tsx shows a start screen instead of a login or a "no server yet" that would
   * only flash by (user's report, 20 September 2026), and the desktop app keeps its start window up.
   */
  starting: boolean;
  /** Direct messages and mentions that arrived while the window did not have the focus (attention.ts); 0 again once it has. */
  missed: number;
  // ---- Client without a home server (desktop app); unused otherwise
  /** Past the client's own login (directory account or this device's key). */
  signedIn: boolean;
  /** Servers added by address, in the order they were added (the rail shows them after the account's). */
  localHosts: string[];
  /** The client's own login: running, and its last error. */
  clientLogin: { busy: boolean; error: string | null };
  /** Invite codes that came with a server address or link, for the join view of that server. */
  joinInvites: Record<string, string>;
};

/** Sessions per server (the token stays secret); v1 held only the own server's and is migrated once. */
const SESSIONS_KEY = "chat.sessions.v2";
const SESSION_KEY_V1 = "chat.session.v1";
type StoredSessions = { publicKey: string; tokens: Record<string, string> };

export const homeState = (s: State): ServerConnState | null => (s.homeHost !== null ? s.servers[s.homeHost] ?? null : null);
export const activeState = (s: State): ServerConnState | null => (s.activeHost !== null ? s.servers[s.activeHost] : undefined) ?? homeState(s);

/** A failed key restore for the login views: the directory's code and body (`totp_required` carries `email`). */
const restoreError = (err: unknown) => Object.assign(new Error("restore failed"), { code: err instanceof api.ApiError ? err.code : null, body: err instanceof api.ApiError ? err.body : {} });

/** What the store needs from the platform (`platform/`): the server that serves the page, or the directory to use when there is none. */
export type StoreOptions = { home: PlatformHome | null; defaultDirectoryUrl: string | null };

const START_SCREEN_MAX_MS = 8000;

export class Store {
  readonly homeHost: string | null;
  /** Domain a login on the home server signs (the hostname of the address bar). */
  private readonly signDomain: string;
  private readonly defaultDirectoryUrl: string | null;
  /** Without a home server: the server viewed last (stored per device, clientHome.ts). */
  private lastHost: string | null = null;
  /** Without a home server: past the login and the first server chosen; a link that arrives earlier waits in `startTarget`. */
  private entered = false;
  private startTarget: string | null = null;
  state: State;
  private conns = new Map<string, ServerConnection>();
  private link: DirectoryLink | null = null;
  /** Game display: what goes out about the running game (gamePresence.ts), and whether chat servers get it or friends only. */
  private game: GamePresence | null = null;
  private gameOnServers = true;
  /** Pair key per friend (M7), derived from your own seed and the friend's key; clear it on an identity switch. */
  private dmKeys = new Map<string, Promise<CryptoKey>>();
  /** The directory has the blob store and the link lookup for previews in direct messages (`features.dmPreviews`). */
  private dmPreviewsAtDirectory = false;
  private listeners = new Set<(s: State) => void>();
  /** Set by the voice client: a kick/session loss on `host` ends the voice connection if it runs there. */
  onRemoved: ((host: string) => void) | null = null;
  /** Moderation (M3) on `host`: moving to another voice channel (null = out) and stopping camera/screen. */
  onVoiceMoved: ((host: string, channelId: string | null, by: string, reason: "afk" | null) => void) | null = null;
  onVoiceStop: ((host: string, what: { camera: boolean; screen: boolean }, by: string) => void) | null = null;
  /** A direct message or a mention arrived that the user does not see right now (App.tsx plays the cue). */
  onIncoming: ((kind: "dm" | "mention") => void) | null = null;
  /** Settings as the directory account holds them (null = none there or no account); user changes are pushed when they differ. */
  private accountSettings: AccountSettings | null = null;
  /** The directory stores all settings (features.settings); false = one that predates them, then only the cue settings follow the account. */
  private settingsSupported = false;
  /** The directory keeps the settings as a blob the client encrypts (features.settingsSealed); then nothing is written in the open any more. */
  private sealedSupported = false;
  /** What the account holds is such a blob already; false = plaintext settings or none, which the next push seals. */
  private accountSealed = false;
  /** The account's status was read once for this account: before that a push would not know what it overwrites and waits (`pushWanted`). */
  private settingsLoaded = false;
  private pushWanted = false;
  /** Hide list of the game display: as the account holds it, and as this device has it (App.tsx; null = this client keeps none, a browser, and passes the account's on). */
  private accountHidden: string[] | null = null;
  private localHidden: string[] | null = null;
  private settingsKey: { publicKey: string; key: Promise<CryptoKey> } | null = null;
  private settingsPushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: StoreOptions) {
    this.homeHost = opts.home?.host ?? null;
    this.signDomain = opts.home?.signDomain ?? "";
    this.defaultDirectoryUrl = opts.defaultDirectoryUrl;
    const home = this.homeHost !== null ? this.createConnection(this.homeHost, "") : null;
    this.state = {
      identity: null, homeHost: this.homeHost, activeHost: this.homeHost, servers: home ? { [home.state.host]: home.state } : {},
      signedIn: false, localHosts: [], clientLogin: { busy: false, error: null }, joinInvites: {},
      directoryUrl: null, directoryAccount: undefined, directoryError: null, directoryEmailRequired: false, directoryAvatars: false, directoryGameLibrary: false, accountServers: null, settingsSyncError: null, settingsSealed: false, accountHiddenGames: null, localeReloadPending: false,
      directoryLink: "idle", directoryLinkError: null, friends: null, conversations: {}, dms: {}, homeOpen: false, currentPeer: null, friendsError: null, missed: 0, starting: true,
    };
    subscribeVoiceSettings((_s, source) => { if (source === "user") this.scheduleSettingsPush(); });
    // AFK detection: every chat server and the directory hear when the user turns idle or comes back (activity.ts).
    activity.subscribe((idle) => { for (const conn of this.conns.values()) conn.setIdle(idle); this.link?.setIdle(idle); });
  }

  subscribe(fn: (s: State) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  private set(p: Partial<State>) { this.state = { ...this.state, ...p }; for (const fn of this.listeners) fn(this.state); }

  /** Connection to a server (your own server is always present when the client has one). */
  connection(host: string | null): ServerConnection | null { return host !== null ? this.conns.get(host) ?? null : null; }
  get home(): ServerConnection | null { return this.connection(this.homeHost); }
  get active(): ServerConnection | null { return this.connection(this.state.activeHost) ?? this.home; }

  private createConnection(host: string, base: string): ServerConnection {
    const conn = new ServerConnection(host, base, () => this.state.identity, {
      onState: (s) => { if (this.state) this.set({ servers: { ...this.state.servers, [host]: s } }); },
      onToken: (token) => this.storeToken(host, token),
      onSessionLost: (message) => this.sessionLost(host, message),
      onRemoved: () => this.onRemoved?.(host),
      // Your own server, or a server the rail does not list yet (first sign-in there): fetch the list again. Servers connected in the
      // background are already on it, asking the directory once per server would be pointless.
      onConnected: () => { this.noteJoined(host); if (host === this.homeHost || !(this.state.accountServers ?? []).some((s) => this.hostFor(s.host) === host)) void this.refreshAccountServers(); },
      onVoiceMoved: (channelId, by, reason) => this.onVoiceMoved?.(host, channelId, by, reason),
      onVoiceStop: (what, by) => this.onVoiceStop?.(host, what, by),
      onMention: (channelId) => this.incoming("mention", this.state.activeHost === host && !this.state.homeOpen && this.conns.get(host)?.state.currentChannelId === channelId),
    });
    conn.setIdle(activity.idle);
    conn.setGame(this.gameOnServers ? this.game : null);
    this.conns.set(host, conn);
    return conn;
  }

  async init() {
    // A server or directory that does not answer must not hold the start screen for long: what is known by then is shown.
    const cap = setTimeout(() => this.set({ starting: false }), START_SCREEN_MAX_MS);
    try { await this.start(); } finally { clearTimeout(cap); if (this.state.starting) this.set({ starting: false }); }
  }
  private async start() {
    const identity = await loadOrCreateIdentity();
    this.set({ identity });
    const home = this.home;
    if (home) {
      void this.refreshDirectory();
      const token = this.storedToken(home.state.host);
      if (token) await home.resume(token);
      return;
    }
    // No home server: the device remembers whether the user is past the login, the added servers and the server viewed last.
    const data = loadClientData();
    this.lastHost = data.lastHost;
    this.set({ signedIn: data.signedIn, localHosts: data.hosts });
    await this.refreshDirectory();
    if (data.signedIn) this.enterClient();
  }

  // ---------- Sessions per server in localStorage
  private readSessions(): StoredSessions | null {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) return JSON.parse(raw) as StoredSessions;
      const v1 = localStorage.getItem(SESSION_KEY_V1);
      if (v1) {
        const s = JSON.parse(v1) as { token: string; publicKey: string };
        const migrated: StoredSessions = { publicKey: s.publicKey, tokens: this.homeHost !== null ? { [this.homeHost]: s.token } : {} };
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
    if (this.homeHost === null || !home) return h;
    return h === home.serverDomain || h === this.homeHost.toLowerCase() || h === this.signDomain.toLowerCase() ? this.homeHost : h;
  }
  /** Show a server in the main area; a foreign server is connected on first use (signing in with your own key). */
  openServer(directoryHost: string) {
    const host = this.hostFor(directoryHost);
    this.set({ activeHost: host, homeOpen: false });
    if (host === this.homeHost) return;
    this.rememberLast(host);
    let conn = this.conns.get(host);
    if (!conn) {
      conn = this.createConnection(host, directoryServerUrl(host));
      this.set({ servers: { ...this.state.servers, [host]: conn.state } });
    }
    const st = conn.state;
    if (st.connection === "idle" && !st.removed) void this.connectForeign(conn);
  }
  /**
   * Connect every server of the rail in the background (signing in with your own key like `openServer`, but without showing
   * it), so the rail can mark servers with unread messages and mentions, live. Only while signed in on your own server;
   * a server whose account deletion is pending is left alone. Consequence: you are online on all your servers.
   */
  private connectAccountServers(servers: readonly AccountServer[]) {
    if (this.homeHost !== null ? !this.home?.state.me : !this.state.signedIn) return;
    for (const s of servers) {
      const host = this.hostFor(s.host);
      if (host === this.homeHost || s.leaveRequestedAt || this.conns.has(host)) continue;
      const conn = this.createConnection(host, directoryServerUrl(host));
      this.set({ servers: { ...this.state.servers, [host]: conn.state } });
      void this.connectForeign(conn);
    }
  }
  /** Try again (after an error or a removal); also the "join" of a server added by address, then possibly with an invite. */
  retryServer(host: string, invite?: string) {
    const conn = this.conns.get(host);
    if (conn && host !== this.homeHost) void this.connectForeign(conn, invite);
  }
  private markUnreachable(conn: ServerConnection) {
    conn.state = { ...conn.state, connection: "error", error: t("err.serverUnreachableShort", { base: conn.state.base }) };
    this.set({ servers: { ...this.state.servers, [conn.state.host]: conn.state } });
  }
  private async connectForeign(conn: ServerConnection, invite?: string) {
    const health = await conn.refreshHealth();
    if (!health) { this.markUnreachable(conn); return; }
    const token = this.storedToken(conn.state.host);
    if (token && await conn.resume(token)) return;
    try { await conn.login(health.domain.toLowerCase(), invite); } catch { /* the message is kept in the server's state */ }
  }
  /** Close a foreign server and remove it from the client's rail (the session stays stored). */
  closeServer(host: string) {
    if (host === this.homeHost) return;
    const conn = this.conns.get(host);
    conn?.close();
    this.conns.delete(host);
    const servers = { ...this.state.servers }; delete servers[host];
    this.set({ servers, localHosts: this.state.localHosts.filter((h) => h !== host), activeHost: this.state.activeHost === host ? this.homeHost : this.state.activeHost });
    if (this.lastHost === host) this.lastHost = null;
    this.saveClient();
  }
  /** Session on `host` gone: own server = back to the login (all connections closed), foreign = signed out there only. */
  private sessionLost(host: string, _message: string) {
    if (host !== this.homeHost) return;
    this.closeAllForeign();
  }
  private closeAllForeign() {
    for (const [host, conn] of this.conns) if (host !== this.homeHost) { conn.close(); this.conns.delete(host); }
    const home = this.home;
    this.set({ servers: home ? { [home.state.host]: home.state } : {}, activeHost: this.homeHost });
  }

  // ---------- Client without a home server (desktop app): own login, servers by address, the server viewed last
  private saveClient() {
    if (this.homeHost === null) saveClientData({ signedIn: this.state.signedIn, hosts: this.state.localHosts, lastHost: this.lastHost });
  }
  private rememberLast(host: string) {
    if (this.homeHost !== null || this.lastHost === host) return;
    this.lastHost = host;
    this.saveClient();
  }
  /** A server connected: one that is not on the account's list (no directory, another directory) is kept as added by address. */
  private noteJoined(host: string) {
    if (this.homeHost !== null) return;
    if (this.state.activeHost === host) this.rememberLast(host);
    if (this.state.localHosts.includes(host) || (this.state.accountServers ?? []).some((s) => this.hostFor(s.host) === host)) return;
    this.set({ localHosts: [...this.state.localHosts, host] });
    this.saveClient();
  }
  /** Past the login: connect the added servers (the account's are connected by `connectAccountServers`) and show one. */
  private enterClient() {
    for (const host of this.state.localHosts) {
      if (this.conns.has(host)) continue;
      const conn = this.createConnection(host, directoryServerUrl(host));
      this.set({ servers: { ...this.state.servers, [host]: conn.state } });
      void this.connectForeign(conn);
    }
    this.entered = true;
    // A link the app was opened with wins over the server viewed last.
    const target = this.startTarget; this.startTarget = null;
    if (target) { void this.addServer(target); return; }
    const host = chooseInitialServer({ last: this.lastHost, accountServers: this.state.accountServers, localHosts: this.state.localHosts });
    if (host) this.openServer(host);
  }
  /**
   * A `squorli://` link reached the app (desktop): shown like an address typed in (`addServer`), so a server the key has never
   * been on waits for a click. Before the client's own login it waits and is shown right after it.
   */
  openLink(input: string) {
    if (this.homeHost !== null) return;
    if (this.entered) void this.addServer(input); else this.startTarget = input;
  }
  /**
   * Sign in with the directory account (handle + password, code with an active authenticator): fetches the key, replaces the
   * device key, then connects the account's servers and opens the one viewed last. Throws like `loginWithHandle`.
   */
  async loginDirectoryAccount(handle: string, password: string, code?: string): Promise<void> {
    const url = this.state.directoryUrl;
    if (!url || this.homeHost !== null) return;
    this.set({ clientLogin: { busy: true, error: null } });
    let id: Identity;
    try { id = await api.directoryRestore(url, handle, password, code); }
    catch (err) {
      this.set({ clientLogin: { busy: false, error: api.explainDirectoryError(err) } });
      throw restoreError(err);
    }
    // Another key than this device had: its sessions and added servers belonged to that key.
    if (id.publicKey !== this.state.identity?.publicKey) {
      this.closeAllForeign();
      this.forgetAllTokens();
      this.lastHost = null;
      this.set({ localHosts: [], joinInvites: {} });
    }
    storeIdentity(id);
    this.set({ identity: id, directoryAccount: undefined, signedIn: true });
    this.saveClient();
    await this.refreshDirectory();
    this.set({ clientLogin: { busy: false, error: null } });
    this.enterClient();
  }
  /** Go on with this device's key (it may have a handle or not; servers without a directory need none). */
  continueWithDeviceKey() {
    if (this.homeHost !== null) return;
    this.set({ signedIn: true, clientLogin: { busy: false, error: null } });
    this.saveClient();
    this.connectAccountServers(this.state.accountServers ?? []);
    void this.connectDirectory();
    this.enterClient();
  }
  /**
   * Show a server named by an address, an invite link or a `squorli://` link (clientHome.ts `parseServerAddress`). A server
   * the key has been on (stored session, added before, or on the account's list) is connected right away; any other one is
   * only looked at (`/api/health`): signing in reveals the public key and creates an account there, so the join view waits
   * for a click (`retryServer(host, invite)`). Returns a message when the input names no server.
   */
  async addServer(input: string): Promise<string | null> {
    const target = parseServerAddress(input);
    if (!target) return t("add.invalid");
    const host = target.host;
    let conn = this.conns.get(host);
    if (!conn) {
      conn = this.createConnection(host, directoryServerUrl(host));
      this.set({ servers: { ...this.state.servers, [host]: conn.state } });
    }
    this.set({ activeHost: host, homeOpen: false, ...(target.invite ? { joinInvites: { ...this.state.joinInvites, [host]: target.invite } } : {}) });
    if (conn.state.me || conn.state.connection !== "idle") { this.rememberLast(host); return null; }
    const mine = !!this.storedToken(host) || this.state.localHosts.includes(host) || (this.state.accountServers ?? []).some((s) => this.hostFor(s.host) === host);
    if (mine) { this.rememberLast(host); void this.connectForeign(conn, target.invite ?? undefined); }
    else if (!(await conn.refreshHealth())) this.markUnreachable(conn);
    return null;
  }

  /** Fetch the directory URL from your own server and check whether your key has a handle there. */
  async refreshDirectory(): Promise<void> {
    const home = this.home;
    const directoryUrl = home ? (await home.refreshHealth())?.directoryUrl ?? null : this.defaultDirectoryUrl;
    this.set({ directoryUrl, directoryError: null });
    const id = this.state.identity;
    if (!directoryUrl || !id) { this.set({ directoryAccount: null }); return; }
    try {
      const account = await api.directoryLookup(directoryUrl, id.publicKey);
      // A key without a handle may register one: the login has to know whether the directory wants an e-mail address for that.
      const emailRequired = account ? false : (await api.directoryHealth(directoryUrl)).features.emailRequired;
      this.set({ directoryAccount: account, directoryEmailRequired: emailRequired });
    }
    catch (err) { this.set({ directoryAccount: undefined, directoryError: api.explainDirectoryError(err) }); }
    const rail = this.refreshAccountServers();
    void this.connectDirectory();
    // Without a home server the caller goes on to pick the server to show, which needs the account's list.
    if (!home) await rail;
  }

  // ---------- M7: directory socket (friends, presence, direct messages)
  /** Open the socket to the directory as soon as directory, account and key are present; otherwise close it. */
  private async connectDirectory() {
    const id = this.state.identity; const url = this.state.directoryUrl;
    this.link?.close(); this.link = null;
    this.dmKeys.clear();
    this.set({ directoryLink: "idle", directoryLinkError: null, friends: null, conversations: {}, dms: {}, homeOpen: false, currentPeer: null });
    if (!id || !url || !this.state.directoryAccount) return;
    if (this.homeHost === null && !this.state.signedIn) return;
    const health = await api.directoryHealth(url).catch(() => null);
    if (!health?.features.friends) return;
    this.dmPreviewsAtDirectory = health.features.dmPreviews;
    const link = new DirectoryLink(url, id, (e) => this.handleDirectory(e), (status, error) => this.set({ directoryLink: status, directoryLinkError: error ?? null }), health.features.afk);
    link.setIdle(activity.idle);
    link.setGame(this.game);
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
    const base = { id: m.id, seq: m.seq, from: m.from, to: m.to, sentAt: m.sentAt };
    try {
      const opened = await openDm(await this.dmKey(peer), m);
      return { ...base, text: opened.text, ...(opened.previews ? { previews: opened.previews } : {}), ...(opened.control ? { control: opened.control } : {}) };
    } catch { return { ...base, text: null }; }
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
        this.set({ friends: (this.state.friends ?? []).map((f) => (f.publicKey === e.publicKey ? { ...f, online: e.online, afk: e.afk, game: e.game } : f)) });
        break;
      case "dm.message": {
        const m = e.message;
        const peer = m.from === me ? m.to : m.from;
        const dm = await this.decrypt(m);
        const t = this.thread(peer);
        if (t.loaded && !t.list.some((x) => x.id === dm.id)) this.setThread(peer, { ...t, list: [...t.list, dm].sort((a, b) => a.seq - b.seq) });
        const viewing = this.state.homeOpen && this.state.currentPeer === peer && document.visibilityState === "visible";
        const prev = this.state.conversations[peer];
        if (dm.control) {
          // An instruction (a preview taken away) is nothing to read: no unread mark, no sound, the conversation stays where
          // it is in the list. With everything before it read, the read cursor moves past it, so it never counts later either.
          if (prev) this.set({ conversations: { ...this.state.conversations, [peer]: { ...prev, lastSeq: m.seq } } });
          if (m.from !== me && (viewing || (prev?.unread ?? 0) === 0)) this.link?.send({ type: "dm.read", peer, seq: m.seq });
          break;
        }
        const unread = m.from === me || viewing ? 0 : (prev?.unread ?? 0) + 1;
        this.set({ conversations: { ...this.state.conversations, [peer]: { peer, lastSeq: m.seq, lastAt: m.sentAt, unread } } });
        if (viewing && m.from !== me) this.link?.send({ type: "dm.read", peer, seq: m.seq });
        if (m.from !== me) this.incoming("dm", this.state.homeOpen && this.state.currentPeer === peer);
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
  /**
   * A direct message or a mention came in live (attention.ts). Seen at once = nothing happens; otherwise the cue sounds, and
   * what arrives while the window does not have the focus is counted for the desktop app's task bar mark until it has.
   */
  private incoming(kind: "dm" | "mention", showing: boolean) {
    const visible = document.visibilityState === "visible";
    const focused = visible && document.hasFocus();
    if (seesIncoming({ visible, focused }, showing)) return;
    if (!focused) this.set({ missed: this.state.missed + 1 });
    this.onIncoming?.(kind);
  }
  /** The window has the focus again. */
  clearMissed() { if (this.state.missed !== 0) this.set({ missed: 0 }); }
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
  /**
   * Encrypt and send a direct message; it is displayed via the directory's echo (dm.message). Links get their previews
   * first (dmPreviews.ts): made here, by the sender, and sent inside the encrypted message.
   */
  async sendDm(peer: string, text: string) {
    const id = this.state.identity;
    if (!id) return;
    const msgId = crypto.randomUUID();
    const key = await this.dmKey(peer);
    const previews = await buildDmPreviews(text, this.previewDeps()).catch(() => []);
    let sealed = await sealDm(key, id.publicKey, peer, msgId, previews.length > 0 ? { text, previews } : { text });
    // A long text plus long descriptions may not fit into one message: the text matters, the previews go.
    if (sealed.ciphertext.length > DM_MAX_CIPHERTEXT_CHARS && previews.length > 0) sealed = await sealDm(key, id.publicKey, peer, msgId, { text });
    if (!this.link?.send({ type: "dm.send", to: peer, id: msgId, ...sealed, sentAt: new Date().toISOString() })) throw new Error(t("dir.noLink"));
  }
  /** Who looks a link up and where the picture goes: the desktop app asks the linked host itself, a browser asks the directory. */
  private previewDeps(): PreviewDeps {
    const id = this.state.identity!; const url = this.state.directoryUrl;
    const viaDirectory = url && this.dmPreviewsAtDirectory;
    return {
      lookUp: async (request) => {
        if (platform.links.lookUp) {
          const found = await platform.links.lookUp(request);
          return found.found ? { kind: found.kind, siteName: found.siteName, title: found.title, description: found.description, image: found.image ? { mime: found.image.mime, bytes: found.image.data } : null } : null;
        }
        if (!viaDirectory) return null;
        const found = await api.directoryLinkLookup(url, id, request);
        if (!found.found || !found.kind) return null;
        return { kind: found.kind, siteName: found.siteName ?? null, title: found.title ?? null, description: found.description ?? null, image: found.image ? { mime: found.image.mime, bytes: base64ToBytes(found.image.data) } : null };
      },
      shrink: shrinkPreviewImage,
      putBlob: viaDirectory ? (ciphertext) => api.directoryPutDmBlob(url, id, ciphertext) : null,
    };
  }
  /** The author takes a preview of their message away, for both sides: an encrypted instruction (dm.ts `DmControl`), shown as nothing. */
  async removeDmPreview(peer: string, messageId: string, url: string) {
    const id = this.state.identity;
    if (!id) return;
    const msgId = crypto.randomUUID();
    const sealed = await sealDm(await this.dmKey(peer), id.publicKey, peer, msgId, { text: "", control: { type: "preview.remove", id: messageId, url } });
    if (!this.link?.send({ type: "dm.send", to: peer, id: msgId, ...sealed, sentAt: new Date().toISOString() })) throw new Error(t("dir.noLink"));
  }
  /** Ciphertext of a preview's picture from the directory's blob store. */
  fetchDmBlob(blobId: string): Promise<Uint8Array> {
    const url = this.state.directoryUrl;
    return url ? api.directoryDmBlob(url, blobId) : Promise.reject(new Error("no directory"));
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
    if (!id || !url || !this.state.directoryAccount) {
      this.accountSettings = null;
      this.accountSealed = false; this.settingsLoaded = false; this.pushWanted = false; this.accountHidden = null;
      if (this.settingsPushTimer) { clearTimeout(this.settingsPushTimer); this.settingsPushTimer = null; }
      this.set({ accountServers: null, settingsSealed: false, accountHiddenGames: null });
      return;
    }
    try {
      const [status, health] = await Promise.all([api.directoryAccountStatus(url, id), api.directoryHealth(url)]);
      this.settingsSupported = health.features.settings;
      this.sealedSupported = health.features.settingsSealed;
      // The public key lookup (refreshDirectory) never carries names; the signed status does: the global display name for the settings.
      const acc = this.state.directoryAccount;
      // The avatar's version comes along: an image changed on the account page shows in the settings without a reload of the lookup.
      this.set({ accountServers: status.servers, directoryAvatars: health.features.avatars, directoryGameLibrary: health.features.gameLibrary, ...(acc ? { directoryAccount: { ...acc, displayName: status.displayName, avatarUpdatedAt: status.avatarUpdatedAt } } : {}) });
      await this.adoptAccountSettings(status);
      // Without a home server: a server added by address that the account's list names by now is the account's from here on.
      const local = this.state.localHosts.filter((h) => !status.servers.some((s) => this.hostFor(s.host) === h));
      if (local.length !== this.state.localHosts.length) { this.set({ localHosts: local }); this.saveClient(); }
      this.connectAccountServers(status.servers);
    } catch (err) { console.warn("Serverliste vom Verzeichnis nicht verfuegbar", err); }
  }

  // ---------- Settings in the account (everything except the device selection, accountSettings.ts): the per-device copy in
  // localStorage (voice/settings.ts, the locale in i18n) stays the working copy, so servers without a directory keep working;
  // with an account the account's copy wins on load and every user change is pushed there (signed, coalesced for slider drags).
  // A directory that predates the full settings only gets the cue settings, as before.
  // Sealed settings (21 September 2026, user's wish: only the user can read them): a directory with `features.settingsSealed` gets
  // the settings as a blob encrypted with a key from the identity's seed (protocol, "Sealed settings") and nothing in the open.
  // Plaintext settings found there are sealed at once, which makes the directory delete them. The blob also carries the game
  // display's hide list, which must not be stored readable (gameDetection.ts).
  /** Account status arrived: take the account's settings over on this device, or seed the account with the local ones if it has none yet. */
  private async adoptAccountSettings(status: AccountStatus): Promise<void> {
    const id = this.state.identity;
    let remote = this.settingsSupported ? status.settings : null;
    let sealed = false; let hidden: string[] | null = null;
    const blob = this.sealedSupported ? status.settingsSealed : null;
    if (id && blob) {
      const content = await this.settingsKeyOf(id).then((key) => openSettings(key, id.publicKey, blob), () => null);
      if (this.state.identity !== id) return;
      // A blob this key does not open counts as none: the device's settings make a new one.
      if (content) { remote = content.settings; hidden = content.hiddenGames ?? null; sealed = true; }
    }
    const first = !this.settingsLoaded;
    this.accountSealed = sealed; this.accountHidden = hidden; this.settingsLoaded = true;
    // A change the user just made here is newer than what the status says; the pending push brings the account in step.
    if (this.settingsPushTimer || this.pushWanted) {
      // The hide list too, with one exception: a push that waited for this first status knows nothing of the account's list
      // yet and must not drop from it what another device hid.
      if (first && hidden && this.localHidden) this.localHidden = [...new Set([...this.localHidden, ...hidden])];
      if (sealed !== this.state.settingsSealed) this.set({ settingsSealed: sealed });
      if (!this.settingsPushTimer) this.scheduleSettingsPush(0);
      return;
    }
    // The device's list is merged with the account's by the game detection; until App.tsx reports the result, the account's goes out.
    if (hidden && !sameHiddenGames(this.localHidden, hidden)) this.localHidden = null;
    if (sealed !== this.state.settingsSealed || (hidden === null) !== (this.state.accountHiddenGames === null) || !sameHiddenGames(hidden, this.state.accountHiddenGames)) this.set({ settingsSealed: sealed, accountHiddenGames: hidden });
    const local = loadVoiceSettings();
    if (!remote) {
      // Nothing stored yet (or an older directory): cue settings stored by an older client still win, the rest is seeded from this device.
      const sounds = status.soundSettings ? normalizeSoundSettings({ ...status.soundSettings, message: status.soundSettings.message ?? local.sounds.message }) : null;
      if (sounds && !sameSoundSettings(local.sounds, sounds)) saveVoiceSettings({ ...local, sounds }, "directory");
      this.accountSettings = sounds && !this.settingsSupported ? this.localAccountSettings() : null;
      this.scheduleSettingsPush(0);
      return;
    }
    this.accountSettings = remote;
    if (!sameAccountSettings(toAccountSettings(local, remote.locale), remote, true)) saveVoiceSettings(applyAccountSettings(local, remote), "directory");
    // Settings still in the open, or a hide list the account lacks: the push seals them.
    if (this.sealedSupported && (!sealed || !sameHiddenGames(this.hiddenForAccount(), hidden))) this.scheduleSettingsPush(0);
    // Language: a choice made on this device since it was last in step with the account (login footer) wins and is pushed;
    // otherwise the account's applies, with a reload only when the texts actually change.
    const pref = localePreference(); const synced = accountLocalePreference();
    if (remote.locale === pref) { markAccountLocalePreference(pref); return; }
    if (synced !== null && pref !== synced) { this.scheduleSettingsPush(0); return; }
    storeLocalePreference(remote.locale);
    markAccountLocalePreference(remote.locale);
    this.reloadForLocale();
  }
  private localAccountSettings(): AccountSettings { return toAccountSettings(loadVoiceSettings(), localePreference()); }
  private hiddenForAccount(): string[] | null { return this.localHidden ?? this.accountHidden; }
  private settingsKeyOf(id: Identity): Promise<CryptoKey> {
    if (this.settingsKey?.publicKey !== id.publicKey) this.settingsKey = { publicKey: id.publicKey, key: deriveSettingsKey(id.privateKey, id.publicKey) };
    return this.settingsKey.key;
  }
  /**
   * The game display's hide list of this device, the part that may follow the account (App.tsx, from the game detection;
   * null = this client keeps none). It only ever travels inside the sealed settings.
   */
  setLocalHiddenGames(ids: string[] | null): void {
    this.localHidden = ids;
    if (this.sealedSupported && this.settingsLoaded && !sameHiddenGames(this.hiddenForAccount(), this.accountHidden)) this.scheduleSettingsPush();
  }
  private scheduleSettingsPush(delayMs = 800): void {
    if (!this.state.identity || !this.state.directoryUrl || !this.state.directoryAccount) return;
    if (this.settingsPushTimer) clearTimeout(this.settingsPushTimer);
    this.settingsPushTimer = setTimeout(() => { this.settingsPushTimer = null; void this.pushSettings(); }, delayMs);
  }
  private async pushSettings(): Promise<void> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url || !this.state.directoryAccount) return;
    // Before the account's status was read, nobody knows what the directory can do or what a push would overwrite (the hide list).
    if (!this.settingsLoaded) { this.pushWanted = true; return; }
    this.pushWanted = false;
    const next = this.localAccountSettings(); const known = this.accountSettings;
    try {
      if (this.sealedSupported) {
        const hidden = this.hiddenForAccount();
        if (this.accountSealed && known && sameAccountSettings(known, next) && sameHiddenGames(hidden, this.accountHidden)) return;
        const blob = await sealSettings(await this.settingsKeyOf(id), id.publicKey, { settings: next, ...(hidden ? { hiddenGames: hidden } : {}) });
        await api.directorySetSealedSettings(url, id, blob);
        markAccountLocalePreference(next.locale);
        this.accountSealed = true; this.accountHidden = hidden;
        this.set({ settingsSealed: true, accountHiddenGames: hidden });
      } else if (this.settingsSupported) {
        if (known && sameAccountSettings(known, next)) return;
        await api.directorySetSettings(url, id, next);
        markAccountLocalePreference(next.locale);
      } else {
        if (known && sameSoundSettings(known.sounds, next.sounds)) return;
        await api.directorySetSoundSettings(url, id, next.sounds);
      }
      this.accountSettings = next;
      if (this.state.settingsSyncError) this.set({ settingsSyncError: null });
    } catch (err) { this.set({ settingsSyncError: api.explainDirectoryError(err) }); }
  }

  /**
   * Game display: what goes out about the running game (App.tsx computes it, gamePresence.ts). The directory always hears it
   * (friends see it); the chat servers only when the user shows it to their members too. The store stays free of the platform:
   * the detection lives in App.tsx.
   */
  setGame(game: GamePresence | null, onServers: boolean): void {
    this.game = game;
    this.gameOnServers = onServers;
    for (const conn of this.conns.values()) conn.setGame(onServers ? game : null);
    this.link?.setGame(game);
  }

  /** Change the UI language: stored on this device, saved in the account first (the reload would cut a pending push off), then reload. */
  async setLocale(pref: LocalePreference): Promise<void> {
    storeLocalePreference(pref);
    if (this.settingsPushTimer) { clearTimeout(this.settingsPushTimer); this.settingsPushTimer = null; }
    await this.pushSettings();
    this.reloadForLocale();
  }

  /** Whether a voice connection is running (App.tsx sets it): a reload would throw the user out of their channel. */
  voiceActive: () => boolean = () => false;

  /**
   * The texts follow a language change through a reload (i18n/index.ts). Not while the user sits in a voice channel (user's
   * requirement, 18 September 2026: "Wenn ich die Sprache in meinem Client ändere möchte ich nicht aus Sprachkanälen
   * geschmissen werden"): the choice is stored, the settings say so, and App.tsx calls `applyPendingLocale` once voice ended.
   */
  private reloadForLocale(): void {
    if (detectLocale() === locale) { if (this.state.localeReloadPending) this.set({ localeReloadPending: false }); return; }
    if (this.voiceActive()) { this.set({ localeReloadPending: true }); return; }
    window.location.reload();
  }
  applyPendingLocale(): void {
    if (this.state.localeReloadPending) this.reloadForLocale();
  }

  /**
   * Register a handle at the directory (M6a). With `directoryEmailRequired` in two calls: with `email` the directory mails a
   * code (result `{ sentTo }`, the masked address), with `email` and `emailCode` it creates the account.
   */
  async registerHandle(handle: string, email?: string, emailCode?: string): Promise<"done" | "failed" | { sentTo: string }> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url) return "failed";
    this.set({ directoryError: null });
    try {
      const res = await api.directoryRegister(url, id, handle, email, emailCode);
      if ("emailPending" in res) return { sentTo: res.sentTo };
      this.set({ directoryAccount: res });
      return "done";
    } catch (err) {
      this.set({ directoryError: api.explainDirectoryError(err) });
      return "failed";
    }
  }

  /**
   * M6b: sign-in with handle + password. Fetches the key from the directory, replaces the device key, then signs in normally.
   * M6c: with an active authenticator the first attempt throws `totp_required`; the login screen then asks for the code.
   */
  async loginWithHandle(handle: string, password: string, invite?: string, code?: string): Promise<void> {
    const url = this.state.directoryUrl; const home = this.home;
    if (!url || !home) return;
    home.state = { ...home.state, connection: "logging-in", error: null, removed: null };
    this.set({ servers: { ...this.state.servers, [home.state.host]: home.state } });
    let id: Identity;
    try { id = await api.directoryRestore(url, handle, password, code); }
    catch (err) {
      const errCode = err instanceof api.ApiError ? err.code : null;
      // totp_required is not an error but the next step: keep the message neutral.
      home.state = { ...home.state, connection: errCode === "totp_required" ? "idle" : "error", error: api.explainDirectoryError(err) };
      this.set({ servers: { ...this.state.servers, [home.state.host]: home.state } });
      throw restoreError(err);
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

  /**
   * Your display name on the server shown (mini profile and settings). With a directory account the directory holds it (as this
   * server's entry, cleared when it equals the global name) and the server adopts it; without one only the server stores it.
   * null = fall back to the global name. Throws on errors (message translated where it comes from the directory).
   */
  async setServerDisplayName(displayName: string | null): Promise<void> {
    const conn = this.active; const acc = this.state.directoryAccount;
    if (!conn) return;
    const domain = conn.state.serverDomain;
    const global = acc?.displayName ?? null;
    if (acc && domain) await this.setDirectoryName(domain, displayName === global ? null : displayName);
    await conn.updateDisplayName(displayName ?? global);
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
   * Store (null = remove) the avatar of the directory account: the image the settings dialog cropped and encoded (avatarImage.ts),
   * signed, uploaded. The own account's state is updated at once; the chat servers get the directory's push and broadcast the
   * member list, friends get a `friends.update`. Throws with a translated message.
   */
  async setAvatar(image: AvatarImage | null): Promise<void> {
    const id = this.state.identity; const url = this.state.directoryUrl;
    if (!id || !url || !this.state.directoryAccount) throw new Error(t("dir.none"));
    let res: Awaited<ReturnType<typeof api.directorySetAvatar>>;
    try { res = await api.directorySetAvatar(url, id, image); }
    catch (err) { throw new Error(api.explainDirectoryError(err)); }
    const acc = this.state.directoryAccount;
    if (acc) this.set({ directoryAccount: { ...acc, avatarUpdatedAt: res.avatarUpdatedAt } });
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
      if (key === this.homeHost) this.home?.accountDeleted();
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
    await this.home?.login(this.signDomain, invite);
  }

  /** Sign out: all servers (the client hangs off your own server's session). */
  logout() {
    const home = this.home;
    if (home) { this.closeAllForeign(); home.logout(); return; }
    // No home server: the client's own login ends, with every session on the servers.
    for (const conn of this.conns.values()) conn.logout();
    this.conns.clear();
    this.forgetAllTokens();
    this.lastHost = null; this.entered = false; this.startTarget = null;
    this.set({ servers: {}, activeHost: null, signedIn: false, localHosts: [], joinInvites: {}, clientLogin: { busy: false, error: null } });
    this.saveClient();
    void this.connectDirectory();
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

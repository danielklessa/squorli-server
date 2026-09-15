import { ChallengeResponse, DirectoryAccount, ServerLeavesResponse, ServerRegisterResponse, ServerResolveResponse, directoryServerRegisterMessage } from "@squorli/protocol";
import * as ed from "@noble/ed25519";
import { count, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config";
import type { Db } from "./db";
import { members, serverSettings, users } from "./db/schema";
import { SETTINGS_ID } from "./state";

/** For this long the cached directory state counts as fresh; after that GET /api/me refreshes it (name changed on the account page). */
const REFRESH_AFTER_MS = 5 * 60_000;
/** Periodic reconciliation of all users (names changed on the account page arrive without a reload this way). */
export const SYNC_INTERVAL_MS = 5 * 60_000;
const SYNC_CHUNK = 200;
const TIMEOUT_MS = 2500;

export type DirectoryProfile = { handle: string | null; displayName: string | null };
const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

/**
 * Integration with the directory service (M6). The server has its own Ed25519 key (server_settings.directory_private_key,
 * generated at startup) and registers with the directory using it: signature over host + nonce, and the directory verifies
 * via /api/health (serverKey) that the server controls its host. The issued token (kept in memory only)
 * allows reading the handle and display name of its own users (`?server=PUBLIC_DOMAIN`); without a token the
 * directory returns only handle and key. On a 401 it re-registers once. Best effort with a short timeout; if the service
 * is unreachable, the last known state stays. The chat server never depends on the service at runtime (PLAN 3.2).
 */
export class DirectoryClient {
  /** Public server key (hex), published in /api/health; null before init(). */
  serverKey: string | null = null;
  private privateKey: Uint8Array | null = null;
  private token: string | null = null;
  private registering: Promise<boolean> | null = null;

  constructor(private readonly db: Db, private readonly config: Config, private readonly log: FastifyBaseLogger) {}

  get enabled(): boolean { return !!this.config.DIRECTORY_URL; }
  private get host(): string { return this.config.PUBLIC_DOMAIN.toLowerCase(); }

  /** Load the server key or generate it once (stays the same across restarts; the directory binds the host to it). */
  async init(): Promise<void> {
    const [s] = await this.db.select({ key: serverSettings.directoryPrivateKey }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
    let hex = s?.key ?? null;
    if (!hex) {
      hex = Buffer.from(ed.utils.randomPrivateKey()).toString("hex");
      await this.db.update(serverSettings).set({ directoryPrivateKey: hex }).where(eq(serverSettings.id, SETTINGS_ID));
      this.log.info("Server-Schluessel fuer das Verzeichnis erzeugt");
    }
    this.privateKey = hexToBytes(hex);
    this.serverKey = Buffer.from(await ed.getPublicKeyAsync(this.privateKey)).toString("hex");
  }

  /** Register with the directory and fetch a token. Call after app.listen: the directory reads /api/health back. */
  register(): Promise<boolean> {
    if (!this.registering) this.registering = this.doRegister().finally(() => { this.registering = null; });
    return this.registering;
  }
  private async doRegister(): Promise<boolean> {
    const url = this.config.DIRECTORY_URL;
    if (!url || !this.privateKey || !this.serverKey) return false;
    try {
      const chRes = await fetch(`${url}/api/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: this.serverKey }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!chRes.ok) { this.log.warn({ status: chRes.status }, "Verzeichnis: Challenge fuer die Server-Registrierung fehlgeschlagen"); return false; }
      const ch = ChallengeResponse.parse(await chRes.json());
      const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.json()) as { host?: string };
      if (!health.host) return false;
      // Server directory (M6d): name, listing, description, open join and member count are sent along; the icon is fetched by the
      // directory itself from our /api/server-icon. That is why the server re-registers after every change to it.
      const [s] = await this.db.select({ name: serverSettings.name, listed: serverSettings.listed, description: serverSettings.description, openJoin: serverSettings.openJoin })
        .from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
      const [mc] = await this.db.select({ n: count() }).from(members);
      const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(directoryServerRegisterMessage(health.host, this.host, ch.nonce)), this.privateKey)).toString("hex");
      const body = {
        host: this.host, name: s?.name ?? null, listed: s?.listed ?? false, description: s?.description ?? null, openJoin: s?.openJoin ?? false, memberCount: mc?.n ?? null,
        publicKey: this.serverKey, challengeId: ch.challengeId, signature, proofUrl: this.config.directoryProofUrl,
      };
      // The proof takes longer: the directory calls our /api/health.
      const res = await fetch(`${url}/api/servers/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        this.log.warn({ status: res.status, error: err.error, detail: err.detail, proofUrl: this.config.directoryProofUrl },
          "Verzeichnis: Server-Registrierung abgelehnt; Anzeigenamen werden nicht uebernommen (DIRECTORY_PROOF_URL muss vom Verzeichnis aus erreichbar sein und serverKey liefern)");
        return false;
      }
      const reg = ServerRegisterResponse.parse(await res.json());
      this.token = reg.token;
      this.log.info({ host: reg.host, expiresAt: reg.expiresAt }, "beim Verzeichnis als Server registriert");
      return true;
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, "Verzeichnis fuer die Server-Registrierung nicht erreichbar");
      return false;
    }
  }

  /**
   * Look up key -> handle and display name and cache it on the user. Display name: the one set in the directory for this
   * server, otherwise the global one; if none is set (or there is no token), the local name stays unchanged.
   */
  async refresh(user: { id: string; publicKey: string; displayName: string | null }): Promise<DirectoryProfile | null> {
    const url = this.config.DIRECTORY_URL;
    if (!url) return null;
    try {
      if (!this.token) await this.register();
      let res = await this.lookup(url, user.publicKey);
      if (res.status === 401 && this.token) {
        // Token expired (24 h) or directory reinstalled: re-register once.
        this.token = null;
        if (await this.register()) res = await this.lookup(url, user.publicKey);
      }
      if (res.status === 401 || res.status === 403) {
        // Without a valid token, at least the handle (which is public).
        this.log.warn({ status: res.status }, "Verzeichnis: kein gueltiges Server-Token, nur Handle wird uebernommen");
        this.token = null;
        res = await fetch(`${url}/api/keys/${user.publicKey}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      }
      let handle: string | null = null;
      let displayName = user.displayName;
      if (res.status === 200) {
        const acc = DirectoryAccount.parse(await res.json());
        handle = acc.handle;
        displayName = acc.serverDisplayName ?? acc.displayName ?? user.displayName;
      } else if (res.status !== 404) { this.log.warn({ status: res.status }, "Verzeichnisdienst antwortet unerwartet"); return null; }
      await this.db.update(users).set({ handle, displayName, handleCheckedAt: new Date() }).where(eq(users.id, user.id));
      return { handle, displayName };
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, "Verzeichnisdienst nicht erreichbar; Handle und Name bleiben wie zuletzt bekannt");
      return null;
    }
  }
  /**
   * Reconcile all users with the directory (bulk query with a token): changed handles/names are stored and
   * reported via onChanged (callers: rename voice presence, send the member list). Returns the number of changes.
   */
  async syncAll(onChanged: (u: { userId: string; publicKey: string; handle: string | null; displayName: string | null }) => void): Promise<number> {
    const url = this.config.DIRECTORY_URL;
    if (!url) return 0;
    if (!this.token && !(await this.register())) return 0;
    const all = await this.db.select({ id: users.id, publicKey: users.publicKey, handle: users.handle, displayName: users.displayName }).from(users);
    let changed = 0;
    try {
      for (let i = 0; i < all.length; i += SYNC_CHUNK) {
        const chunk = all.slice(i, i + SYNC_CHUNK);
        let res = await this.resolveMany(url, chunk.map((u) => u.publicKey));
        if (res.status === 401) { this.token = null; if (!(await this.register())) return changed; res = await this.resolveMany(url, chunk.map((u) => u.publicKey)); }
        if (!res.ok) { this.log.warn({ status: res.status }, "Verzeichnis: Abgleich fehlgeschlagen"); return changed; }
        const byKey = new Map(ServerResolveResponse.parse(await res.json()).map((a) => [a.publicKey, a]));
        const now = new Date();
        for (const u of chunk) {
          const acc = byKey.get(u.publicKey);
          if (!acc) continue; // no account: the local state stays
          const displayName = acc.serverDisplayName ?? acc.displayName ?? u.displayName;
          if (acc.handle === u.handle && displayName === u.displayName) continue;
          await this.db.update(users).set({ handle: acc.handle, displayName, handleCheckedAt: now }).where(eq(users.id, u.id));
          onChanged({ userId: u.id, publicKey: u.publicKey, handle: acc.handle, displayName });
          changed++;
        }
        const ids = chunk.filter((u) => byKey.has(u.publicKey)).map((u) => u.id);
        if (ids.length) await this.db.update(users).set({ handleCheckedAt: now }).where(inArray(users.id, ids));
      }
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, "Verzeichnis: Abgleich abgebrochen");
    }
    if (changed) this.log.info({ changed }, "Namen aus dem Verzeichnis uebernommen");
    return changed;
  }
  /** Push from the directory (POST /api/directory/notify): reload one user via a bulk query (does not count as a sign-in). */
  async syncOne(publicKey: string, onChanged: (u: { userId: string; publicKey: string; handle: string | null; displayName: string | null }) => void): Promise<boolean> {
    const url = this.config.DIRECTORY_URL;
    if (!url) return false;
    const [u] = await this.db.select({ id: users.id, publicKey: users.publicKey, handle: users.handle, displayName: users.displayName }).from(users).where(eq(users.publicKey, publicKey)).limit(1);
    if (!u) return false;
    try {
      if (!this.token && !(await this.register())) return false;
      let res = await this.resolveMany(url, [publicKey]);
      if (res.status === 401) { this.token = null; if (!(await this.register())) return false; res = await this.resolveMany(url, [publicKey]); }
      if (!res.ok) return false;
      const acc = ServerResolveResponse.parse(await res.json())[0];
      if (!acc) return false;
      const displayName = acc.serverDisplayName ?? acc.displayName ?? u.displayName;
      await this.db.update(users).set({ handle: acc.handle, displayName, handleCheckedAt: new Date() }).where(eq(users.id, u.id));
      if (acc.handle === u.handle && displayName === u.displayName) return false;
      onChanged({ userId: u.id, publicKey, handle: acc.handle, displayName });
      return true;
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, "Verzeichnis: Einzelabgleich fehlgeschlagen");
      return false;
    }
  }
  /**
   * Account deletion requested through the directory (push POST /api/directory/leave or the pending list): confirm with our
   * token via POST /api/servers/leave/confirm. Only a 200 (the directory had a pending request of this user for exactly our host,
   * signed by the user) allows deleting; "not_pending" = nothing to do (a stranger or a stale push), null = directory unreachable.
   */
  async confirmLeave(publicKey: string): Promise<"confirmed" | "not_pending" | null> {
    const url = this.config.DIRECTORY_URL;
    if (!url) return null;
    try {
      if (!this.token && !(await this.register())) return null;
      let res = await this.postConfirm(url, publicKey);
      if (res.status === 401) { this.token = null; if (!(await this.register())) return null; res = await this.postConfirm(url, publicKey); }
      if (res.status === 200) return "confirmed";
      if (res.status === 404) return "not_pending";
      this.log.warn({ status: res.status }, "Verzeichnis: Bestaetigung der Konto-Loeschung fehlgeschlagen");
      return null;
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, "Verzeichnis: Bestaetigung der Konto-Loeschung nicht moeglich");
      return null;
    }
  }
  /** Pending deletions for this server (missed pushes), fetched during the periodic reconciliation. */
  async pendingLeaves(): Promise<string[]> {
    const url = this.config.DIRECTORY_URL;
    if (!url || !this.token) return [];
    try {
      const res = await fetch(`${url}/api/servers/leaves`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return [];
      return ServerLeavesResponse.parse(await res.json()).publicKeys;
    } catch { return []; }
  }
  private postConfirm(url: string, publicKey: string): Promise<Response> {
    return fetch(`${url}/api/servers/leave/confirm`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ publicKey }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
  private resolveMany(url: string, publicKeys: string[]): Promise<Response> {
    return fetch(`${url}/api/servers/resolve`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ publicKeys }), signal: AbortSignal.timeout(8000),
    });
  }
  private lookup(url: string, publicKey: string): Promise<Response> {
    const headers: Record<string, string> = this.token ? { authorization: `Bearer ${this.token}` } : {};
    const q = this.token ? `?server=${encodeURIComponent(this.host)}` : "";
    return fetch(`${url}/api/keys/${publicKey}${q}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
}

/** Whether the cached state is old enough to be refreshed on GET /api/me. */
export function directoryStale(checkedAt: Date | null): boolean {
  return checkedAt === null || Date.now() - checkedAt.getTime() > REFRESH_AFTER_MS;
}

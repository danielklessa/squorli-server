import { ChallengeResponse, DirectoryAccount, ServerRegisterResponse, ServerResolveResponse, directoryServerRegisterMessage } from "@squorli/protocol";
import * as ed from "@noble/ed25519";
import { eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config";
import type { Db } from "./db";
import { serverSettings, users } from "./db/schema";
import { SETTINGS_ID } from "./state";

/** So lange gilt der gecachte Verzeichnis-Stand als frisch; danach erneuert GET /api/me ihn (Name von der Kontoseite geaendert). */
const REFRESH_AFTER_MS = 5 * 60_000;
/** Periodischer Abgleich aller Nutzer (Namen, die auf der Kontoseite geaendert wurden, kommen so ohne Neuladen an). */
export const SYNC_INTERVAL_MS = 5 * 60_000;
const SYNC_CHUNK = 200;
const TIMEOUT_MS = 2500;

export type DirectoryProfile = { handle: string | null; displayName: string | null };
const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

/**
 * Anbindung an den Verzeichnisdienst (M6). Der Server hat einen eigenen Ed25519-Schluessel (server_settings.directory_private_key,
 * beim Start erzeugt) und registriert sich damit beim Verzeichnis: Signatur ueber Host + Nonce, dazu weist das Verzeichnis
 * ueber /api/health (serverKey) nach, dass der Server seinen Host kontrolliert. Das ausgegebene Token (nur im Speicher)
 * erlaubt, Handle und Anzeigename der eigenen Nutzer zu lesen (`?server=PUBLIC_DOMAIN`); ohne Token liefert das
 * Verzeichnis nur Handle und Schluessel. Bei 401 wird einmal neu registriert. Best effort mit kurzem Timeout; ist der Dienst
 * nicht erreichbar, bleibt der letzte bekannte Stand. Der Chat-Server haengt zur Laufzeit nie vom Dienst ab (PLAN 3.2).
 */
export class DirectoryClient {
  /** Oeffentlicher Server-Schluessel (hex), in /api/health veroeffentlicht; null vor init(). */
  serverKey: string | null = null;
  private privateKey: Uint8Array | null = null;
  private token: string | null = null;
  private registering: Promise<boolean> | null = null;

  constructor(private readonly db: Db, private readonly config: Config, private readonly log: FastifyBaseLogger) {}

  get enabled(): boolean { return !!this.config.DIRECTORY_URL; }
  private get host(): string { return this.config.PUBLIC_DOMAIN.toLowerCase(); }

  /** Server-Schluessel laden oder einmalig erzeugen (bleibt ueber Neustarts gleich; das Verzeichnis bindet den Host daran). */
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

  /** Beim Verzeichnis registrieren und ein Token holen. Nach app.listen aufrufen: das Verzeichnis liest /api/health zurueck. */
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
      const [s] = await this.db.select({ name: serverSettings.name }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
      const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(directoryServerRegisterMessage(health.host, this.host, ch.nonce)), this.privateKey)).toString("hex");
      const body = { host: this.host, name: s?.name ?? null, publicKey: this.serverKey, challengeId: ch.challengeId, signature, proofUrl: this.config.directoryProofUrl };
      // Der Nachweis dauert laenger: das Verzeichnis ruft unsere /api/health auf.
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
   * Schluessel -> Handle und Anzeigename nachschlagen und am Nutzer cachen. Anzeigename: der im Verzeichnis fuer diesen Server
   * gesetzte, sonst der globale; ist keiner gesetzt (oder gibt es kein Token), bleibt der lokale Name unveraendert.
   */
  async refresh(user: { id: string; publicKey: string; displayName: string | null }): Promise<DirectoryProfile | null> {
    const url = this.config.DIRECTORY_URL;
    if (!url) return null;
    try {
      if (!this.token) await this.register();
      let res = await this.lookup(url, user.publicKey);
      if (res.status === 401 && this.token) {
        // Token abgelaufen (24 h) oder Verzeichnis neu aufgesetzt: einmal neu registrieren.
        this.token = null;
        if (await this.register()) res = await this.lookup(url, user.publicKey);
      }
      if (res.status === 401 || res.status === 403) {
        // Ohne gueltiges Token wenigstens das Handle (oeffentlich).
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
   * Alle Nutzer mit dem Verzeichnis abgleichen (Sammelabfrage mit Token): geaenderte Handles/Namen werden gespeichert und
   * ueber onChanged gemeldet (Aufrufer: Sprachpraesenz umbenennen, Mitgliederliste senden). Liefert die Zahl der Aenderungen.
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
          if (!acc) continue; // kein Konto: lokaler Stand bleibt
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
  /** Push vom Verzeichnis (POST /api/directory/notify): einen Nutzer per Sammelabfrage neu laden (zaehlt nicht als Login). */
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

/** Ob der gecachte Stand alt genug ist, um ihn bei GET /api/me zu erneuern. */
export function directoryStale(checkedAt: Date | null): boolean {
  return checkedAt === null || Date.now() - checkedAt.getTime() > REFRESH_AFTER_MS;
}

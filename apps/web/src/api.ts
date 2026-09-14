import {
  AccountStatus, Ban, ChallengeResponse, DirectoryAccount, DirectoryHealth, FriendSearchResponse, ServerListResponse, Handle, Invite, InvitePreview, Me, Message, MessagePage, RtcTokenResponse, ServerState, SessionInfo, VerifyResponse,
  BackupBlob, BackupParamsResponse, challengeMessage, createBackup, deriveBackupKeys, directoryActionMessage, directoryBackupMessage, directoryProfilePayload,
  directoryRegisterMessage, openBackup,
  type Attachment, type Category, type Channel, type Role,
} from "@squorli/protocol";
import { z } from "zod";
import { type Identity, identityFromPrivateKey, sign } from "./identity";

export class ApiError extends Error {
  constructor(method: string, path: string, readonly status: number, readonly code: string | null, readonly body: Record<string, unknown>) {
    super(`${method} ${path} -> ${status}${code ? ` (${code})` : ""}`);
  }
}

/**
 * Zugriff auf einen Chat-Server. `base` = "" fuer den Server, der diesen Client ausliefert (relative Pfade, Vite-Proxy im Dev),
 * sonst die Origin eines fremden Servers (Multi-Server-Client: die Server-Leiste wechselt zwischen Servern, ohne die Seite zu
 * verlassen; fremde Server antworten dank CORS mit Bearer-Token). Jede Instanz hat ihr eigenes Sitzungstoken.
 */
export class ServerApi {
  private token: string | null = null;
  /** Wird gerufen, wenn der Server ein gesetztes Token mit 401 ablehnt (abgelaufen oder von einem anderen Geraet abgemeldet, M6c). */
  onUnauthorized: (() => void) | null = null;
  constructor(readonly base: string) {}
  setToken(t: string | null) { this.token = t; }
  getToken() { return this.token; }
  /** Relative Server-URL (Anhaenge, Server-Icon) auf diesen Server beziehen. */
  abs(url: string): string { return this.base && url.startsWith("/") ? `${this.base}${url}` : url; }

  private async request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; form?: FormData } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    const init: RequestInit = { method, headers };
    if (opts.form) init.body = opts.form;
    else if (body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    const withAuth = opts.auth !== false && !!this.token;
    if (withAuth) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.base}${path}`, init);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 401 && withAuth) this.onUnauthorized?.();
      throw new ApiError(method, path, res.status, typeof b.error === "string" ? b.error : null, b);
    }
    return (await res.json()) as T;
  }

  // ---------- Auth
  /** Anmelden: die Signatur ist an `domain` gebunden (PUBLIC_DOMAIN des Servers; eigener Server = Hostname der Adressleiste). */
  async login(id: Identity, domain: string, invite?: string): Promise<VerifyResponse> {
    const challenge = ChallengeResponse.parse(await this.request("POST", "/api/auth/challenge", { publicKey: id.publicKey }, { auth: false }));
    const signature = await sign(id, challengeMessage(domain, challenge.nonce));
    return VerifyResponse.parse(await this.request("POST", "/api/auth/verify",
      { challengeId: challenge.challengeId, publicKey: id.publicKey, signature, ...(invite ? { invite } : {}) }, { auth: false }));
  }
  getHealth() { return this.request<Health>("GET", "/api/health", undefined, { auth: false }); }

  getMe() { return this.request<Me>("GET", "/api/me").then((m) => Me.parse(m)); }
  updateMe(displayName: string | null) { return this.request<Me>("PATCH", "/api/me", { displayName }).then((m) => Me.parse(m)); }
  // ---------- Sitzungen / Geraete (M6c)
  getSessions() { return this.request<SessionInfo[]>("GET", "/api/me/sessions").then((s) => z.array(SessionInfo).parse(s)); }
  revokeSession(id: string) { return this.request("DELETE", `/api/me/sessions/${id}`); }
  revokeOtherSessions() { return this.request<{ ok: true; revoked: number }>("DELETE", "/api/me/sessions/others"); }
  /** Eigene Sitzung serverseitig beenden (beim Abmelden); best effort. */
  logoutSession() { return this.request("DELETE", "/api/me/sessions/current"); }
  getState() { return this.request<ServerState>("GET", "/api/state").then((s) => ServerState.parse(s)); }
  getInvitePreview(code: string) { return this.request<InvitePreview>("GET", `/api/invites/${encodeURIComponent(code)}`, undefined, { auth: false }).then((p) => InvitePreview.parse(p)); }

  // ---------- Nachrichten
  getMessages(channelId: string, before?: number) {
    return this.request<MessagePage>("GET", `/api/channels/${channelId}/messages?limit=50${before ? `&before=${before}` : ""}`).then((p) => MessagePage.parse(p));
  }
  sendMessage(channelId: string, content: string, attachmentIds: string[]) {
    return this.request<Message>("POST", `/api/channels/${channelId}/messages`, { content, attachmentIds }).then((m) => Message.parse(m));
  }
  editMessage(id: string, content: string) { return this.request<Message>("PATCH", `/api/messages/${id}`, { content }).then((m) => Message.parse(m)); }
  deleteMessage(id: string) { return this.request("DELETE", `/api/messages/${id}`); }
  async uploadAttachment(file: File): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file, file.name);
    return this.request<Attachment>("POST", "/api/attachments", undefined, { form });
  }

  // ---------- Sprache
  rtcToken(channelId: string) { return this.request<RtcTokenResponse>("POST", "/api/rtc-token", { channelId }).then((r) => RtcTokenResponse.parse(r)); }

  // ---------- Verwaltung
  updateSettings(patch: { name?: string; openJoin?: boolean; requireAccount?: boolean; listed?: boolean; description?: string | null }) { return this.request("PATCH", "/api/settings", patch); }
  /** Server-Icon (PNG/JPEG/WebP/GIF, 2 MB); erscheint in Seitenleiste und Favicon. */
  async uploadServerIcon(file: File): Promise<{ ok: true; iconUrl: string | null }> {
    const form = new FormData();
    form.append("file", file, file.name);
    return this.request("PUT", "/api/settings/icon", undefined, { form });
  }
  deleteServerIcon() { return this.request("DELETE", "/api/settings/icon"); }
  /** Eigentuemerstatus (nur Eigentuemer; der erste Eigentuemer ist unentziehbar). */
  setOwner(userId: string, owner: boolean) { return this.request("PUT", `/api/members/${userId}/owner`, { owner }); }
  createCategory(name: string) { return this.request<Category>("POST", "/api/categories", { name }); }
  updateCategory(id: string, patch: { name?: string; position?: number }) { return this.request("PATCH", `/api/categories/${id}`, patch); }
  deleteCategory(id: string) { return this.request("DELETE", `/api/categories/${id}`); }
  createChannel(data: { kind: "text" | "voice"; name: string; topic?: string | null; categoryId?: string | null }) { return this.request<Channel>("POST", "/api/channels", data); }
  updateChannel(id: string, patch: { name?: string; topic?: string | null; categoryId?: string | null; position?: number; audioBitrate?: number; audioStereo?: boolean }) { return this.request("PATCH", `/api/channels/${id}`, patch); }
  deleteChannel(id: string) { return this.request("DELETE", `/api/channels/${id}`); }
  createRole(data: { name: string; color?: string | null; permissions?: number }) { return this.request<Role>("POST", "/api/roles", data); }
  updateRole(id: string, patch: { name?: string; color?: string | null; permissions?: number; position?: number }) { return this.request("PATCH", `/api/roles/${id}`, patch); }
  deleteRole(id: string) { return this.request("DELETE", `/api/roles/${id}`); }
  setMemberRoles(userId: string, roleIds: string[]) { return this.request("PUT", `/api/members/${userId}/roles`, { roleIds }); }
  kickMember(userId: string) { return this.request("DELETE", `/api/members/${userId}`); }
  moveMember(userId: string, channelId: string | null) { return this.request("POST", `/api/members/${userId}/move`, { channelId }); }
  stopMemberStreams(userId: string, what: { camera: boolean; screen: boolean }) { return this.request("POST", `/api/members/${userId}/stream/stop`, what); }
  setStreamBlocked(userId: string, blocked: boolean) { return this.request("PUT", `/api/members/${userId}/stream`, { blocked }); }
  banMember(userId: string, reason: string | null) { return this.request("POST", "/api/bans", { userId, reason }); }
  unban(userId: string) { return this.request("DELETE", `/api/bans/${userId}`); }
  listBans() { return this.request<Ban[]>("GET", "/api/bans").then((b) => z.array(Ban).parse(b)); }
  createInvite(data: { expiresInHours?: number | null; maxUses?: number | null }) { return this.request<Invite>("POST", "/api/invites", data).then((i) => Invite.parse(i)); }
  listInvites() { return this.request<Invite[]>("GET", "/api/invites").then((i) => z.array(Invite).parse(i)); }
  revokeInvite(code: string) { return this.request("DELETE", `/api/invites/${encodeURIComponent(code)}`); }
}

/** Uebersetzt Login-Fehler in einen Satz, der sagt, was zu tun ist. */
export async function explainLoginError(err: unknown, api: ServerApi, here: string): Promise<string> {
  if (err instanceof TypeError) return api.base ? `Der Server ${api.base} ist nicht erreichbar oder erlaubt keinen Zugriff aus anderen Clients (älterer Squorli-Server ohne CORS).` : "Der Server ist nicht erreichbar.";
  if (!(err instanceof ApiError)) return String(err);
  switch (err.code) {
    case "signature_invalid": {
      const health = await api.getHealth().catch(() => null);
      if (health?.domain && health.domain !== here) {
        return `Anmeldung abgelehnt: Der Server erwartet die Domain "${health.domain}" (PUBLIC_DOMAIN), diese Seite läuft unter "${here}". Beides muss übereinstimmen.`;
      }
      return `Anmeldung abgelehnt: Signatur ungültig (Domain "${here}"). Identität verwerfen und erneut versuchen.`;
    }
    case "challenge_invalid": return "Anmeldung abgelehnt: Challenge abgelaufen oder Server neu gestartet. Bitte erneut versuchen.";
    case "invite_required": return "Dieser Server ist nur mit Einladung betretbar. Bitte Einladungscode eingeben.";
    case "invite_invalid": return "Die Einladung ist ungültig, abgelaufen oder aufgebraucht.";
    case "account_required": return "Dieser Server verlangt ein Konto beim Verzeichnis. Melde dich mit einem Konto an oder registriere ein Handle für diesen Schlüssel.";
    case "banned": return `Du bist auf diesem Server gebannt${typeof err.body.reason === "string" && err.body.reason ? `: ${err.body.reason}` : "."}`;
    default: return err.message;
  }
}

export type Health = {
  ok: boolean; domain: string; protocolVersion: number; directoryUrl: string | null; serverName: string | null; iconUrl: string | null;
  /** Anmeldung nur mit Verzeichniskonto (Verwaltung > Server); der Server meldet false, wenn er kein Verzeichnis nutzt. */
  requireAccount: boolean;
  /** Serverversion (package.json), im Login unten neben dem Squorli-Hinweis. */
  version: string;
};

// ---------- Verzeichnisdienst (M6): laeuft unter eigener URL, wird direkt aus dem Browser aufgerufen
async function directoryFetch<T>(dirUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body !== undefined ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method };
  const res = await fetch(`${dirUrl}${path}`, init);
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(method, path, res.status, typeof b.error === "string" ? b.error : null, b);
  }
  return (await res.json()) as T;
}
/** Handle zu einem Schluessel; null = nicht registriert. */
export async function directoryLookup(dirUrl: string, publicKey: string): Promise<DirectoryAccount | null> {
  try { return DirectoryAccount.parse(await directoryFetch(dirUrl, "GET", `/api/keys/${publicKey}`)); }
  catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
}
/** Handle registrieren: Besitznachweis per Signatur ueber eine Challenge, gebunden an den Host des Dienstes. */
export async function directoryRegister(dirUrl: string, id: Identity, rawHandle: string): Promise<DirectoryAccount> {
  const handle = Handle.parse(rawHandle);
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryRegisterMessage(health.host, handle, ch.nonce));
  return DirectoryAccount.parse(await directoryFetch(dirUrl, "POST", "/api/register", { handle, publicKey: id.publicKey, challengeId: ch.challengeId, signature }));
}
/** M6b: Passwort-Backup fuer den eigenen Schluessel ablegen (Chiffretext signiert, Passwort bleibt im Client). */
export async function directoryBackupUpload(dirUrl: string, id: Identity, password: string): Promise<void> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const b = await createBackup(password, id.privateKey);
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryBackupMessage(health.host, ch.nonce, b.ciphertext));
  await directoryFetch(dirUrl, "PUT", "/api/backup", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, ciphertext: b.ciphertext, params: b.params, authKey: b.authKey });
}
/** M6b: Schluessel per Handle + Passwort vom Verzeichnis holen und entschluesseln. M6c: `code` nach 401 totp_required (Authenticator oder Wiederherstellungscode). */
export async function directoryRestore(dirUrl: string, rawHandle: string, password: string, code?: string): Promise<Identity> {
  const handle = Handle.parse(rawHandle);
  const p = BackupParamsResponse.parse(await directoryFetch(dirUrl, "GET", `/api/backup/${handle}/params`));
  const keys = await deriveBackupKeys(password, p.salt, p.iterations);
  const blob = BackupBlob.parse(await directoryFetch(dirUrl, "POST", "/api/backup/fetch", { handle, authKey: keys.authKey, ...(code ? { code } : {}) }));
  let seed: string;
  try { seed = await openBackup(keys, blob.params.iv, blob.ciphertext); }
  catch { throw new Error("Das Backup ließ sich nicht entschlüsseln (beschädigt?)."); }
  const id = await identityFromPrivateKey(seed);
  if (id.publicKey !== blob.publicKey) throw new Error("Das Backup passt nicht zum registrierten Schlüssel.");
  return id;
}
/** Anzeigename im Verzeichnis: server = null -> global (alle Server), sonst nur fuer diesen Chat-Server (Host = dessen PUBLIC_DOMAIN). */
export async function directorySetDisplayName(dirUrl: string, id: Identity, server: string | null, displayName: string | null): Promise<void> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryActionMessage(health.host, "profile-update", ch.nonce, directoryProfilePayload(server, displayName)));
  await directoryFetch(dirUrl, "POST", "/api/profile", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, server, displayName });
}
/** Handle-Suche fuer die Freundesliste (M7, oeffentlich, Praefix, hoechstens 10 Treffer). */
export const directorySearchHandles = (dirUrl: string, q: string) => directoryFetch(dirUrl, "GET", `/api/handles?q=${encodeURIComponent(q)}`).then((r) => FriendSearchResponse.parse(r));
export const directoryHealth = (dirUrl: string) => directoryFetch(dirUrl, "GET", "/api/health").then((r) => DirectoryHealth.parse(r));
/** Oeffentliches Serververzeichnis (M6d): alle Server, die sich auflisten lassen. */
export const directoryServers = (dirUrl: string) => directoryFetch(dirUrl, "GET", "/api/servers").then((r) => ServerListResponse.parse(r));
/** Kontostatus (signiert): u. a. die Server, auf denen sich das Handle angemeldet hat (Server-Leiste, M6d). */
export async function directoryAccountStatus(dirUrl: string, id: Identity): Promise<AccountStatus> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryActionMessage(health.host, "account-status", ch.nonce));
  return AccountStatus.parse(await directoryFetch(dirUrl, "POST", "/api/account/status", { publicKey: id.publicKey, challengeId: ch.challengeId, signature }));
}
export function explainDirectoryError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "auth_invalid": return "Handle oder Passwort falsch.";
      case "no_backup": return "Für dieses Handle gibt es kein Passwort-Backup. Lege es in dem Browser an, in dem das Handle registriert wurde („Passwort festlegen“ im Login).";
      case "no_account": return "Dieser Schlüssel hat noch kein Handle.";
      case "not_found": return "Unbekanntes Handle.";
      case "bad_handle": return "Ungültiges Handle.";
      case "handle_taken": return "Dieses Handle ist schon vergeben.";
      case "key_registered": return `Dieser Schlüssel hat bereits das Handle @${String(err.body.handle ?? "?")}.`;
      case "rate_limited": return "Zu viele Versuche, bitte kurz warten.";
      case "bad_request": return `Ungültiges Handle: ${String(err.body.detail ?? "3-32 Zeichen, a-z, 0-9, Punkt, Unterstrich")}.`;
      case "signature_invalid": return "Der Dienst hat die Signatur abgelehnt. Passt DIRECTORY_PUBLIC_URL des Dienstes zu seiner Adresse?";
      case "challenge_invalid": return "Anfrage abgelaufen, bitte erneut versuchen.";
      case "totp_required": return "Dieses Konto ist mit einem Authenticator geschützt. Bitte den Code aus der App oder einen Wiederherstellungscode eingeben.";
      case "totp_invalid": return "Code ungültig.";
      case "totp_reused": return "Dieser Code wurde schon verwendet. Bitte den nächsten aus der App abwarten.";
      case "server_unknown": return "Dieser Server ist beim Verzeichnis nicht registriert; ein Name nur für diesen Server lässt sich deshalb nicht speichern.";
      case "totp_unavailable": return "Der Verzeichnisdienst kann den Authenticator gerade nicht prüfen.";
      default: return err.message;
    }
  }
  if (err instanceof Error && err.name === "ZodError") return "Ungültiges Handle: 3-32 Zeichen, a-z, 0-9, Punkt, Unterstrich; beginnt und endet mit Buchstabe oder Ziffer.";
  if (err instanceof TypeError) return "Verzeichnisdienst nicht erreichbar (Netzwerk oder CORS). Läuft der Dienst unter der in /api/health genannten Adresse?";
  return String(err);
}

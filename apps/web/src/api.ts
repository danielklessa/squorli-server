import {
  Ban, ChallengeResponse, DirectoryAccount, DirectoryHealth, Handle, Invite, InvitePreview, Me, Message, MessagePage, RtcTokenResponse, ServerState, SessionInfo, VerifyResponse,
  BackupBlob, BackupParamsResponse, challengeMessage, createBackup, deriveBackupKeys, directoryBackupMessage, directoryRegisterMessage, openBackup,
  type Attachment, type Category, type Channel, type Role,
} from "@squorli/protocol";
import { z } from "zod";
import { type Identity, identityFromPrivateKey, sign } from "./identity";

export class ApiError extends Error {
  constructor(method: string, path: string, readonly status: number, readonly code: string | null, readonly body: Record<string, unknown>) {
    super(`${method} ${path} -> ${status}${code ? ` (${code})` : ""}`);
  }
}

let authToken: string | null = null;
export const setToken = (t: string | null) => { authToken = t; };
export const getToken = () => authToken;
/** Wird gerufen, wenn der Server ein gesetztes Token mit 401 ablehnt (abgelaufen oder von einem anderen Geraet abgemeldet, M6c). */
let unauthorizedHandler: (() => void) | null = null;
export const onUnauthorized = (fn: (() => void) | null) => { unauthorizedHandler = fn; };

async function request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers };
  if (opts.form) init.body = opts.form;
  else if (body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  const withAuth = opts.auth !== false && !!authToken;
  if (withAuth) headers.authorization = `Bearer ${authToken}`;
  const res = await fetch(path, init);
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401 && withAuth) unauthorizedHandler?.();
    throw new ApiError(method, path, res.status, typeof b.error === "string" ? b.error : null, b);
  }
  return (await res.json()) as T;
}

// ---------- Auth
export async function login(id: Identity, invite?: string): Promise<VerifyResponse> {
  const challenge = ChallengeResponse.parse(await request("POST", "/api/auth/challenge", { publicKey: id.publicKey }, { auth: false }));
  const message = challengeMessage(window.location.hostname, challenge.nonce);
  const signature = await sign(id, message);
  return VerifyResponse.parse(await request("POST", "/api/auth/verify",
    { challengeId: challenge.challengeId, publicKey: id.publicKey, signature, ...(invite ? { invite } : {}) }, { auth: false }));
}

/** Uebersetzt Login-Fehler in einen Satz, der sagt, was zu tun ist. */
export async function explainLoginError(err: unknown): Promise<string> {
  if (!(err instanceof ApiError)) return String(err);
  const here = window.location.hostname;
  switch (err.code) {
    case "signature_invalid": {
      const health = await fetch("/api/health").then((r) => r.json()).catch(() => null) as { domain?: string } | null;
      if (health?.domain && health.domain !== here) {
        return `Anmeldung abgelehnt: Der Server erwartet die Domain "${health.domain}" (PUBLIC_DOMAIN), diese Seite läuft unter "${here}". Beides muss übereinstimmen.`;
      }
      return `Anmeldung abgelehnt: Signatur ungültig (Domain "${here}"). Identität verwerfen und erneut versuchen.`;
    }
    case "challenge_invalid": return "Anmeldung abgelehnt: Challenge abgelaufen oder Server neu gestartet. Bitte erneut versuchen.";
    case "invite_required": return "Dieser Server ist nur mit Einladung betretbar. Bitte Einladungscode eingeben.";
    case "invite_invalid": return "Die Einladung ist ungültig, abgelaufen oder aufgebraucht.";
    case "banned": return `Du bist auf diesem Server gebannt${typeof err.body.reason === "string" && err.body.reason ? `: ${err.body.reason}` : "."}`;
    default: return err.message;
  }
}

export type Health = { ok: boolean; domain: string; protocolVersion: number; directoryUrl: string | null; serverName: string | null; iconUrl: string | null };
export const getHealth = () => request<Health>("GET", "/api/health", undefined, { auth: false });

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
      case "totp_unavailable": return "Der Verzeichnisdienst kann den Authenticator gerade nicht prüfen.";
      default: return err.message;
    }
  }
  if (err instanceof Error && err.name === "ZodError") return "Ungültiges Handle: 3-32 Zeichen, a-z, 0-9, Punkt, Unterstrich; beginnt und endet mit Buchstabe oder Ziffer.";
  if (err instanceof TypeError) return "Verzeichnisdienst nicht erreichbar (Netzwerk oder CORS). Läuft der Dienst unter der in /api/health genannten Adresse?";
  return String(err);
}

export const getMe = () => request<Me>("GET", "/api/me").then((m) => Me.parse(m));
export const updateMe = (displayName: string | null) => request<Me>("PATCH", "/api/me", { displayName }).then((m) => Me.parse(m));
// ---------- Sitzungen / Geraete (M6c)
export const getSessions = () => request<SessionInfo[]>("GET", "/api/me/sessions").then((s) => z.array(SessionInfo).parse(s));
export const revokeSession = (id: string) => request("DELETE", `/api/me/sessions/${id}`);
export const revokeOtherSessions = () => request<{ ok: true; revoked: number }>("DELETE", "/api/me/sessions/others");
/** Eigene Sitzung serverseitig beenden (beim Abmelden); best effort. */
export const logoutSession = () => request("DELETE", "/api/me/sessions/current");
export const getState = () => request<ServerState>("GET", "/api/state").then((s) => ServerState.parse(s));
export const getInvitePreview = (code: string) => request<InvitePreview>("GET", `/api/invites/${encodeURIComponent(code)}`, undefined, { auth: false }).then((p) => InvitePreview.parse(p));

// ---------- Nachrichten
export const getMessages = (channelId: string, before?: number) =>
  request<MessagePage>("GET", `/api/channels/${channelId}/messages?limit=50${before ? `&before=${before}` : ""}`).then((p) => MessagePage.parse(p));
export const sendMessage = (channelId: string, content: string, attachmentIds: string[]) =>
  request<Message>("POST", `/api/channels/${channelId}/messages`, { content, attachmentIds }).then((m) => Message.parse(m));
export const editMessage = (id: string, content: string) => request<Message>("PATCH", `/api/messages/${id}`, { content }).then((m) => Message.parse(m));
export const deleteMessage = (id: string) => request("DELETE", `/api/messages/${id}`);
export async function uploadAttachment(file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file, file.name);
  return request<Attachment>("POST", "/api/attachments", undefined, { form });
}

// ---------- Sprache
export const rtcToken = (channelId: string) => request<RtcTokenResponse>("POST", "/api/rtc-token", { channelId }).then((r) => RtcTokenResponse.parse(r));

// ---------- Verwaltung
export const updateSettings = (patch: { name?: string; openJoin?: boolean }) => request("PATCH", "/api/settings", patch);
/** Server-Icon (PNG/JPEG/WebP/GIF, 2 MB); erscheint in Seitenleiste und Favicon. */
export async function uploadServerIcon(file: File): Promise<{ ok: true; iconUrl: string | null }> {
  const form = new FormData();
  form.append("file", file, file.name);
  return request("PUT", "/api/settings/icon", undefined, { form });
}
export const deleteServerIcon = () => request("DELETE", "/api/settings/icon");
/** Eigentuemerstatus (nur Eigentuemer; der erste Eigentuemer ist unentziehbar). */
export const setOwner = (userId: string, owner: boolean) => request("PUT", `/api/members/${userId}/owner`, { owner });
export const createCategory = (name: string) => request<Category>("POST", "/api/categories", { name });
export const updateCategory = (id: string, patch: { name?: string; position?: number }) => request("PATCH", `/api/categories/${id}`, patch);
export const deleteCategory = (id: string) => request("DELETE", `/api/categories/${id}`);
export const createChannel = (data: { kind: "text" | "voice"; name: string; topic?: string | null; categoryId?: string | null }) => request<Channel>("POST", "/api/channels", data);
export const updateChannel = (id: string, patch: { name?: string; topic?: string | null; categoryId?: string | null; position?: number; audioBitrate?: number; audioStereo?: boolean }) => request("PATCH", `/api/channels/${id}`, patch);
export const deleteChannel = (id: string) => request("DELETE", `/api/channels/${id}`);
export const createRole = (data: { name: string; color?: string | null; permissions?: number }) => request<Role>("POST", "/api/roles", data);
export const updateRole = (id: string, patch: { name?: string; color?: string | null; permissions?: number; position?: number }) => request("PATCH", `/api/roles/${id}`, patch);
export const deleteRole = (id: string) => request("DELETE", `/api/roles/${id}`);
export const setMemberRoles = (userId: string, roleIds: string[]) => request("PUT", `/api/members/${userId}/roles`, { roleIds });
export const kickMember = (userId: string) => request("DELETE", `/api/members/${userId}`);
export const moveMember = (userId: string, channelId: string | null) => request("POST", `/api/members/${userId}/move`, { channelId });
export const stopMemberStreams = (userId: string, what: { camera: boolean; screen: boolean }) => request("POST", `/api/members/${userId}/stream/stop`, what);
export const setStreamBlocked = (userId: string, blocked: boolean) => request("PUT", `/api/members/${userId}/stream`, { blocked });
export const banMember = (userId: string, reason: string | null) => request("POST", "/api/bans", { userId, reason });
export const unban = (userId: string) => request("DELETE", `/api/bans/${userId}`);
export const listBans = () => request<Ban[]>("GET", "/api/bans").then((b) => z.array(Ban).parse(b));
export const createInvite = (data: { expiresInHours?: number | null; maxUses?: number | null }) => request<Invite>("POST", "/api/invites", data).then((i) => Invite.parse(i));
export const listInvites = () => request<Invite[]>("GET", "/api/invites").then((i) => z.array(Invite).parse(i));
export const revokeInvite = (code: string) => request("DELETE", `/api/invites/${encodeURIComponent(code)}`);

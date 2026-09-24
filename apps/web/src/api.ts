import {
  AccountStatus, Ban, ChallengeResponse, DirectoryAccount, DirectoryHealth, DirectoryRegisterPending, EmailAddress, EmailCode, EmailCodeResponse, FriendSearchResponse, ServerLeaveResponse, ServerListResponse, Handle, Invite, InvitePreview, Me, Message, MessagePage, RtcTokenResponse, ServerState, SessionInfo, VerifyResponse,
  AvatarUpdateResponse, avatarDigest, directoryAvatarPayload,
  BackupBlob, BackupParamsResponse, challengeMessage, createBackup, deriveBackupKeys, directoryActionMessage, directoryBackupMessage, directoryProfilePayload,
  directoryRegisterMessage, directorySoundSettingsPayload, openBackup, type AccountSettings, type SealedSettings, type SoundSettings,
  MuteState, ReadStateResponse, StatusApiKeyResponse, type Attachment, type Category, type Channel, type RadioStation, type Role, type StatusApiMode,
  type DiscordImportRequest, type DiscordImportResult, type ImportPlan,
  DmBlobPutResponse, LinkLookupResponse, directoryDmBlobUrl, directoryLinkLookupPayload, OverwritesResponse, type PermissionOverwrite, type ChannelNotification, type ChannelBlock, type ChannelBlockMinutes } from "@squorli/protocol";
import { z } from "zod";
import { toBase64, type AvatarImage } from "./avatarImage";
import { type Identity, identityFromPrivateKey, sign } from "./identity";
import { t } from "./i18n";

export class ApiError extends Error {
  constructor(method: string, path: string, readonly status: number, readonly code: string | null, readonly body: Record<string, unknown>) {
    super(`${method} ${path} -> ${status}${code ? ` (${code})` : ""}`);
  }
}

/**
 * Access to one chat server. `base` = "" for the server that serves this client (relative paths, Vite proxy in dev),
 * otherwise the origin of a foreign server (multi-server client: the server rail switches between servers without leaving
 * the page; foreign servers answer thanks to CORS with a bearer token). Each instance has its own session token.
 */
/** PATCH /api/channels/:id: everything the channel dialog edits (the channel settings since 23 September 2026). */
export type ChannelPatch = {
  name?: string; topic?: string | null; categoryId?: string | null; position?: number; audioBitrate?: number; audioStereo?: boolean;
  sticky?: boolean; stickyPersist?: boolean; stickyHideVoice?: boolean; userLimit?: number | null; slowmodeSeconds?: number; defaultNotify?: ChannelNotification; allowRadio?: boolean; allowVideo?: boolean; allowVoteKick?: boolean;
};

export class ServerApi {
  private token: string | null = null;
  /** Called when the server rejects a set token with a 401 (expired, or signed out from another device, M6c). */
  onUnauthorized: (() => void) | null = null;
  constructor(readonly base: string) {}
  setToken(t: string | null) { this.token = t; }
  getToken() { return this.token; }
  /** Resolve a relative server URL (attachments, server icon) against this server. */
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
  /** Sign in: the signature is bound to `domain` (the server's PUBLIC_DOMAIN; own server = the hostname in the address bar). */
  async login(id: Identity, domain: string, invite?: string): Promise<VerifyResponse> {
    const challenge = ChallengeResponse.parse(await this.request("POST", "/api/auth/challenge", { publicKey: id.publicKey }, { auth: false }));
    const signature = await sign(id, challengeMessage(domain, challenge.nonce));
    return VerifyResponse.parse(await this.request("POST", "/api/auth/verify",
      { challengeId: challenge.challengeId, publicKey: id.publicKey, signature, ...(invite ? { invite } : {}) }, { auth: false }));
  }
  getHealth() { return this.request<Health>("GET", "/api/health", undefined, { auth: false }); }

  getMe() { return this.request<Me>("GET", "/api/me").then((m) => Me.parse(m)); }
  updateMe(displayName: string | null) { return this.request<Me>("PATCH", "/api/me", { displayName }).then((m) => Me.parse(m)); }
  // ---------- Sessions / devices (M6c)
  getSessions() { return this.request<SessionInfo[]>("GET", "/api/me/sessions").then((s) => z.array(SessionInfo).parse(s)); }
  revokeSession(id: string) { return this.request("DELETE", `/api/me/sessions/${id}`); }
  revokeOtherSessions() { return this.request<{ ok: true; revoked: number }>("DELETE", "/api/me/sessions/others"); }
  /** End your own session server-side (when signing out); best effort. */
  logoutSession() { return this.request("DELETE", "/api/me/sessions/current"); }
  getState() { return this.request<ServerState>("GET", "/api/state").then((s) => ServerState.parse(s)); }
  getInvitePreview(code: string) { return this.request<InvitePreview>("GET", `/api/invites/${encodeURIComponent(code)}`, undefined, { auth: false }).then((p) => InvitePreview.parse(p)); }

  // ---------- Messages
  /** Read states kept by the server (all my devices). Older servers answer 404: the caller falls back to the per-device state. */
  getReadState() { return this.request<ReadStateResponse>("GET", "/api/read-state").then((p) => ReadStateResponse.parse(p)); }
  /** Mute a text channel or this whole server for myself; the answer is my complete mute state. */
  setChannelMuted(channelId: string, muted: boolean) { return this.request<MuteState>("PUT", `/api/channels/${channelId}/mute`, { muted }).then((p) => MuteState.parse(p)); }
  setServerMuted(muted: boolean) { return this.request<MuteState>("PUT", "/api/me/mute", { muted }).then((p) => MuteState.parse(p)); }
  markRead(channelId: string, seq: number) { return this.request<{ lastReadSeq: number }>("POST", `/api/channels/${channelId}/read`, { seq }); }
  getMessages(channelId: string, before?: number) {
    return this.request<MessagePage>("GET", `/api/channels/${channelId}/messages?limit=50${before ? `&before=${before}` : ""}`).then((p) => MessagePage.parse(p));
  }
  sendMessage(channelId: string, content: string, attachmentIds: string[]) {
    return this.request<Message>("POST", `/api/channels/${channelId}/messages`, { content, attachmentIds }).then((m) => Message.parse(m));
  }
  editMessage(id: string, content: string) { return this.request<Message>("PATCH", `/api/messages/${id}`, { content }).then((m) => Message.parse(m)); }
  deleteMessage(id: string) { return this.request("DELETE", `/api/messages/${id}`); }
  /** The author takes one link preview of their message away; the change arrives as `message.update`. */
  removePreview(id: string, url: string) { return this.request("POST", `/api/messages/${id}/previews/remove`, { url }); }
  async uploadAttachment(file: File): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file, file.name);
    return this.request<Attachment>("POST", "/api/attachments", undefined, { form });
  }

  // ---------- Voice
  rtcToken(channelId: string) { return this.request<RtcTokenResponse>("POST", "/api/rtc-token", { channelId }).then((r) => RtcTokenResponse.parse(r)); }

  // ---------- Admin
  updateSettings(patch: { name?: string; openJoin?: boolean; requireAccount?: boolean; listed?: boolean; description?: string | null; radioAutoStop?: boolean; afkChannelId?: string | null; statusApi?: StatusApiMode; statusApiRoleId?: string | null }) { return this.request("PATCH", "/api/settings", patch); }
  /** Status API (docs/features/status-api.md): the key for mode "key" (MANAGE_SERVER), and a fresh one that replaces it. */
  getStatusApiKey() { return this.request<StatusApiKeyResponse>("GET", "/api/settings/status-api-key").then((r) => StatusApiKeyResponse.parse(r)); }
  regenerateStatusApiKey() { return this.request<StatusApiKeyResponse>("POST", "/api/settings/status-api-key").then((r) => StatusApiKeyResponse.parse(r)); }
  /** Server icon (PNG/JPEG/WebP/GIF, 2 MB); appears in the sidebar and as the favicon. */
  async uploadServerIcon(file: File): Promise<{ ok: true; iconUrl: string | null }> {
    const form = new FormData();
    form.append("file", file, file.name);
    return this.request("PUT", "/api/settings/icon", undefined, { form });
  }
  deleteServerIcon() { return this.request("DELETE", "/api/settings/icon"); }
  /** Owner status (owners only; the first owner cannot be revoked). */
  setOwner(userId: string, owner: boolean) { return this.request("PUT", `/api/members/${userId}/owner`, { owner }); }
  createCategory(name: string) { return this.request<Category>("POST", "/api/categories", { name }); }
  updateCategory(id: string, patch: { name?: string; position?: number }) { return this.request("PATCH", `/api/categories/${id}`, patch); }
  deleteCategory(id: string) { return this.request("DELETE", `/api/categories/${id}`); }
  createChannel(data: { kind: "text" | "voice"; name: string; topic?: string | null; categoryId?: string | null }) { return this.request<Channel>("POST", "/api/channels", data); }
  updateChannel(id: string, patch: ChannelPatch) { return this.request("PATCH", `/api/channels/${id}`, patch); }
  deleteChannel(id: string) { return this.request("DELETE", `/api/channels/${id}`); }
  // ---------- Channel permissions (docs/features/channel-permissions.md): the whole list per channel or category, MANAGE_CHANNELS there.
  getOverwrites(scope: "channels" | "categories", id: string) { return this.request<OverwritesResponse>("GET", `/api/${scope}/${id}/overwrites`).then((r) => OverwritesResponse.parse(r)); }
  setOverwrites(scope: "channels" | "categories", id: string, overwrites: PermissionOverwrite[]) { return this.request<OverwritesResponse>("PUT", `/api/${scope}/${id}/overwrites`, { overwrites }).then((r) => OverwritesResponse.parse(r)); }
  // ---------- Web radio (stations: MANAGE_SERVER; a channel's radio: CONTROL_RADIO). The result arrives via the structure event.
  /** Import of a Discord server template (docs/features/import.md): the plan for a typed link or code, then the import of the chosen entries. */
  discordImportPreview(code: string) { return this.request<ImportPlan>("POST", "/api/import/discord/preview", { code }); }
  discordImport(body: DiscordImportRequest) { return this.request<DiscordImportResult>("POST", "/api/import/discord", body); }
  createRadioStation(data: { name: string; url: string }) { return this.request<RadioStation>("POST", "/api/radio/stations", data); }
  updateRadioStation(id: string, patch: { name?: string; url?: string }) { return this.request<RadioStation>("PATCH", `/api/radio/stations/${id}`, patch); }
  deleteRadioStation(id: string) { return this.request("DELETE", `/api/radio/stations/${id}`); }
  /** `videoIds`: the videos of the address's YouTube playlist, read by this client (youtubePlaylist.ts); the server plays them as a queue. */
  startRadio(channelId: string, stationId: string, videoIds?: string[]) { return this.request("PUT", `/api/channels/${channelId}/radio`, { stationId, ...(videoIds ? { videoIds } : {}) }); }
  /** Any address instead of a station (also CONTROL_RADIO). */
  startRadioUrl(channelId: string, url: string, videoIds?: string[]) { return this.request("PUT", `/api/channels/${channelId}/radio`, { url, ...(videoIds ? { videoIds } : {}) }); }
  /** A queue's next or previous video (CONTROL_RADIO), or with `ended` a listener's report that `from` is over. */
  advanceRadio(channelId: string, move: { from: string; step?: 1 | -1; ended?: boolean }) { return this.request("POST", `/api/channels/${channelId}/radio/advance`, move); }
  /** A listener's report that the Twitch stream `channel` is over: the radio turns off (an older server does not know the route). */
  radioOffline(channelId: string, channel: string) { return this.request("POST", `/api/channels/${channelId}/radio/offline`, { channel }); }
  stopRadio(channelId: string) { return this.request("DELETE", `/api/channels/${channelId}/radio`); }
  /** Play, pause, move a video for everyone (CONTROL_RADIO); the result arrives as `radio.playback`. */
  setRadioPlayback(channelId: string, playback: { playing: boolean; position: number; rate: number }) { return this.request("PUT", `/api/channels/${channelId}/radio/playback`, playback); }
  createRole(data: { name: string; color?: string | null; permissions?: number }) { return this.request<Role>("POST", "/api/roles", data); }
  updateRole(id: string, patch: { name?: string; color?: string | null; permissions?: number; position?: number }) { return this.request("PATCH", `/api/roles/${id}`, patch); }
  deleteRole(id: string) { return this.request("DELETE", `/api/roles/${id}`); }
  setMemberRoles(userId: string, roleIds: string[]) { return this.request("PUT", `/api/members/${userId}/roles`, { roleIds }); }
  kickMember(userId: string) { return this.request("DELETE", `/api/members/${userId}`); }
  moveMember(userId: string, channelId: string | null) { return this.request("POST", `/api/members/${userId}/move`, { channelId }); }
  /** Channel blocks (docs/features/channel-blocks.md): the running ones where I may move members; set (minutes null = permanent) and lift. */
  channelBlocks() { return this.request<ChannelBlock[]>("GET", "/api/channel-blocks"); }
  setChannelBlock(channelId: string, userId: string, minutes: ChannelBlockMinutes | null) { return this.request<ChannelBlock>("PUT", `/api/channels/${channelId}/blocks`, { userId, minutes }); }
  liftChannelBlock(channelId: string, userId: string) { return this.request("DELETE", `/api/channels/${channelId}/blocks/${userId}`); }
  stopMemberStreams(userId: string, what: { camera: boolean; screen: boolean }) { return this.request("POST", `/api/members/${userId}/stream/stop`, what); }
  setStreamBlocked(userId: string, blocked: boolean) { return this.request("PUT", `/api/members/${userId}/stream`, { blocked }); }
  /** Vote kick (docs/features/votekick.md): start a vote about somebody in the voice channel one sits in; the result arrives over the WebSocket. */
  startVoteKick(channelId: string, targetId: string) { return this.request("POST", `/api/channels/${channelId}/votekick`, { targetId }); }
  castVoteKick(channelId: string, yes: boolean) { return this.request("POST", `/api/channels/${channelId}/votekick/vote`, { yes }); }
  banMember(userId: string, reason: string | null) { return this.request("POST", "/api/bans", { userId, reason }); }
  unban(userId: string) { return this.request("DELETE", `/api/bans/${userId}`); }
  listBans() { return this.request<Ban[]>("GET", "/api/bans").then((b) => z.array(Ban).parse(b)); }
  createInvite(data: { expiresInHours?: number | null; maxUses?: number | null }) { return this.request<Invite>("POST", "/api/invites", data).then((i) => Invite.parse(i)); }
  listInvites() { return this.request<Invite[]>("GET", "/api/invites").then((i) => z.array(Invite).parse(i)); }
  revokeInvite(code: string) { return this.request("DELETE", `/api/invites/${encodeURIComponent(code)}`); }
}

/** Turns sign-in errors into a sentence that says what to do. */
export async function explainLoginError(err: unknown, api: ServerApi, here: string): Promise<string> {
  if (err instanceof TypeError) return api.base ? t("err.serverUnreachableCors", { base: api.base }) : t("err.serverUnreachable");
  if (!(err instanceof ApiError)) return String(err);
  switch (err.code) {
    case "signature_invalid": {
      const health = await api.getHealth().catch(() => null);
      if (health?.domain && health.domain !== here) return t("err.domainMismatch", { expected: health.domain, here });
      return t("err.signatureInvalid", { here });
    }
    case "challenge_invalid": return t("err.challengeInvalid");
    case "invite_required": return t("err.inviteRequired");
    case "invite_invalid": return t("err.inviteInvalid");
    case "account_required": return t("err.accountRequired");
    case "banned": return `${t("err.banned")}${typeof err.body.reason === "string" && err.body.reason ? `: ${err.body.reason}` : "."}`;
    default: return err.message;
  }
}

export type Health = {
  ok: boolean; domain: string; protocolVersion: number; directoryUrl: string | null; serverName: string | null; iconUrl: string | null;
  /** Sign-in only with a directory account (Admin > Server); the server reports false if it does not use a directory. */
  requireAccount: boolean;
  /** New members need an invite code (the server is not open). Missing on servers older than 19 September 2026. */
  inviteRequired?: boolean;
  /** Server version (package.json), shown at the bottom of the login next to the Squorli note. */
  version: string;
};

// ---------- Directory service (M6): runs under its own URL and is called directly from the browser
async function directoryFetch<T>(dirUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body !== undefined ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method };
  const res = await fetch(`${dirUrl}${path}`, init);
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(method, path, res.status, typeof b.error === "string" ? b.error : null, b);
  }
  return (await res.json()) as T;
}
/** Handle for a key; null = not registered. */
export async function directoryLookup(dirUrl: string, publicKey: string): Promise<DirectoryAccount | null> {
  try { return DirectoryAccount.parse(await directoryFetch(dirUrl, "GET", `/api/keys/${publicKey}`)); }
  catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
}
/**
 * Register a handle: proof of ownership via a signature over a challenge, bound to the service's host. A directory that reports
 * `features.emailRequired` wants a confirmed e-mail address: the call with `email` mails an 8-digit code and returns
 * `{ sentTo }` (the masked address), the call with `email` and `emailCode` creates the account.
 */
export async function directoryRegister(dirUrl: string, id: Identity, rawHandle: string, rawEmail?: string, rawCode?: string): Promise<DirectoryAccount | DirectoryRegisterPending> {
  const handle = Handle.parse(rawHandle);
  const email = rawEmail === undefined ? undefined : EmailAddress.parse(rawEmail);
  const emailCode = rawCode === undefined ? undefined : EmailCode.parse(rawCode);
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryRegisterMessage(health.host, handle, ch.nonce, email));
  const res = await directoryFetch<Record<string, unknown>>(dirUrl, "POST", "/api/register", { handle, publicKey: id.publicKey, challengeId: ch.challengeId, signature, ...(email ? { email } : {}), ...(emailCode ? { emailCode } : {}) });
  return res.emailPending === true ? DirectoryRegisterPending.parse(res) : DirectoryAccount.parse(res);
}
/** M6b: store a password backup of your own key (ciphertext signed, the password stays in the client). */
export async function directoryBackupUpload(dirUrl: string, id: Identity, password: string): Promise<void> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const b = await createBackup(password, id.privateKey);
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryBackupMessage(health.host, ch.nonce, b.ciphertext));
  await directoryFetch(dirUrl, "PUT", "/api/backup", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, ciphertext: b.ciphertext, params: b.params, authKey: b.authKey });
}
/** M6b: fetch the key from the directory via handle + password and decrypt it. M6c: `code` after a 401 totp_required (authenticator or recovery code). */
export async function directoryRestore(dirUrl: string, rawHandle: string, password: string, code?: string): Promise<Identity> {
  const handle = Handle.parse(rawHandle);
  const p = BackupParamsResponse.parse(await directoryFetch(dirUrl, "GET", `/api/backup/${handle}/params`));
  const keys = await deriveBackupKeys(password, p.salt, p.iterations);
  const blob = BackupBlob.parse(await directoryFetch(dirUrl, "POST", "/api/backup/fetch", { handle, authKey: keys.authKey, ...(code ? { code } : {}) }));
  let seed: string;
  try { seed = await openBackup(keys, blob.params.iv, blob.ciphertext); }
  catch { throw new Error(t("err.backupUndecryptable")); }
  const id = await identityFromPrivateKey(seed);
  if (id.publicKey !== blob.publicKey) throw new Error(t("err.backupMismatch"));
  return id;
}
/**
 * Code by e-mail as the second factor (after a 401 totp_required whose body says `email: true`): proves the password again
 * (handle + auth key) and the directory mails an 8-digit code to the confirmed address; it then goes into `code` of directoryRestore.
 */
export async function directoryEmailCode(dirUrl: string, rawHandle: string, password: string): Promise<EmailCodeResponse> {
  const handle = Handle.parse(rawHandle);
  const p = BackupParamsResponse.parse(await directoryFetch(dirUrl, "GET", `/api/backup/${handle}/params`));
  const keys = await deriveBackupKeys(password, p.salt, p.iterations);
  return EmailCodeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/email/code", { handle, authKey: keys.authKey }));
}
/** Display name in the directory: server = null -> global (all servers), otherwise only for this chat server (host = its PUBLIC_DOMAIN). */
export async function directorySetDisplayName(dirUrl: string, id: Identity, server: string | null, displayName: string | null): Promise<void> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryActionMessage(health.host, "profile-update", ch.nonce, directoryProfilePayload(server, displayName)));
  await directoryFetch(dirUrl, "POST", "/api/profile", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, server, displayName });
}
/**
 * Avatar of the directory account (signed over the type and the SHA-256 of the image bytes; null = remove). The image is already
 * normalized (avatarImage.ts). A directory from before the avatars has no such route: said in words instead of a bare 404.
 */
export async function directorySetAvatar(dirUrl: string, id: Identity, image: AvatarImage | null): Promise<AvatarUpdateResponse> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  if (!health.features.avatars) throw new Error(t("dir.avatars_unsupported"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const payload = directoryAvatarPayload(image?.mime ?? null, image ? await avatarDigest(image.bytes) : null);
  const signature = await sign(id, directoryActionMessage(health.host, "avatar-set", ch.nonce, payload));
  return AvatarUpdateResponse.parse(await directoryFetch(dirUrl, "POST", "/api/avatar", {
    publicKey: id.publicKey, challengeId: ch.challengeId, signature, avatar: image ? { mime: image.mime, data: toBase64(image.bytes) } : null,
  }));
}
/**
 * Link previews in direct messages, for a sender whose client cannot look a link up itself (a browser): the directory does it
 * (signed, so only accounts ask, and limited per account). The desktop app never calls this: it asks the linked host itself.
 */
export async function directoryLinkLookup(dirUrl: string, id: Identity, request: { url: string } | { youtube: string }): Promise<LinkLookupResponse> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryActionMessage(health.host, "link-lookup", ch.nonce, directoryLinkLookupPayload(request)));
  return LinkLookupResponse.parse(await directoryFetch(dirUrl, "POST", "/api/link-lookup", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, ...request }));
}
/** Store a picture the client has encrypted (dm.ts `sealDmBlob`) in the directory's blob store; the signature covers the hash of the bytes. */
export async function directoryPutDmBlob(dirUrl: string, id: Identity, ciphertext: Uint8Array): Promise<string> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
  const signature = await sign(id, directoryActionMessage(health.host, "dm-blob-put", ch.nonce, digest));
  return DmBlobPutResponse.parse(await directoryFetch(dirUrl, "POST", "/api/dm-blobs", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, data: toBase64(ciphertext) })).id;
}
/** The ciphertext of a blob; whoever has the id (it travels inside the encrypted message) may fetch it. */
export async function directoryDmBlob(dirUrl: string, blobId: string): Promise<Uint8Array> {
  const res = await fetch(directoryDmBlobUrl(dirUrl, blobId));
  if (!res.ok) throw new ApiError("GET", "/api/dm-blobs", res.status, null, {});
  return new Uint8Array(await res.arrayBuffer());
}
/** Voice cue settings in the account (signed): follow the account across chat servers and devices; read back via directoryAccountStatus(). */
export async function directorySetSoundSettings(dirUrl: string, id: Identity, soundSettings: SoundSettings): Promise<void> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryActionMessage(health.host, "sound-settings", ch.nonce, directorySoundSettingsPayload(soundSettings)));
  await directoryFetch(dirUrl, "POST", "/api/sound-settings", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, soundSettings });
}
/** All client settings in the account (signed; the JSON string itself is the signed payload): follow the account like the cue settings, which they include. */
export async function directorySetSettings(dirUrl: string, id: Identity, accountSettings: AccountSettings): Promise<void> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const settings = JSON.stringify(accountSettings);
  const signature = await sign(id, directoryActionMessage(health.host, "settings", ch.nonce, settings));
  await directoryFetch(dirUrl, "POST", "/api/settings", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, settings });
}
/** The settings as a blob only the user can read (directory `features.settingsSealed`; signed like `settings`: the JSON string itself is the payload). */
export async function directorySetSealedSettings(dirUrl: string, id: Identity, blob: SealedSettings): Promise<void> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const sealed = JSON.stringify(blob);
  const signature = await sign(id, directoryActionMessage(health.host, "settings-sealed", ch.nonce, sealed));
  await directoryFetch(dirUrl, "POST", "/api/settings/sealed", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, sealed });
}
/** Delete your account on one chat server (host = its PUBLIC_DOMAIN): signed at the directory, which notifies the server; it confirms and deletes the user. */
export async function directoryLeaveServer(dirUrl: string, id: Identity, server: string): Promise<ServerLeaveResponse> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryActionMessage(health.host, "server-leave", ch.nonce, server));
  return ServerLeaveResponse.parse(await directoryFetch(dirUrl, "POST", "/api/servers/leave", { publicKey: id.publicKey, challengeId: ch.challengeId, signature, server }));
}
/** Handle search for the friends list (M7, public, prefix, at most 10 hits). */
export const directorySearchHandles = (dirUrl: string, q: string) => directoryFetch(dirUrl, "GET", `/api/handles?q=${encodeURIComponent(q)}`).then((r) => FriendSearchResponse.parse(r));
export const directoryHealth = (dirUrl: string) => directoryFetch(dirUrl, "GET", "/api/health").then((r) => DirectoryHealth.parse(r));
/** Public server directory (M6d): all servers that opt into being listed. */
export const directoryServers = (dirUrl: string) => directoryFetch(dirUrl, "GET", "/api/servers").then((r) => ServerListResponse.parse(r));
/** Account status (signed): among other things, the servers the handle has signed in on (server rail, M6d). */
export async function directoryAccountStatus(dirUrl: string, id: Identity): Promise<AccountStatus> {
  const health = DirectoryHealth.parse(await directoryFetch(dirUrl, "GET", "/api/health"));
  const ch = ChallengeResponse.parse(await directoryFetch(dirUrl, "POST", "/api/challenge", { publicKey: id.publicKey }));
  const signature = await sign(id, directoryActionMessage(health.host, "account-status", ch.nonce));
  return AccountStatus.parse(await directoryFetch(dirUrl, "POST", "/api/account/status", { publicKey: id.publicKey, challengeId: ch.challengeId, signature }));
}
export function explainDirectoryError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "auth_invalid": case "no_backup": case "no_account": case "not_found": case "bad_handle": case "handle_taken": case "rate_limited":
      case "signature_invalid": case "challenge_invalid": case "totp_required": case "totp_invalid": case "totp_reused": case "server_unknown": case "totp_unavailable":
      case "founder": case "server_refused": case "email_unavailable": case "no_email": case "mail_failed": case "totp_disabled":
      case "email_required": case "email_code_invalid": case "email_taken": case "avatar_too_large": case "avatar_invalid":
        return t(`dir.${err.code}`);
      case "key_registered": return t("dir.key_registered", { handle: String(err.body.handle ?? "?") });
      case "bad_request": return t("dir.bad_request", { detail: String(err.body.detail ?? t("dir.handleRules")) });
      default: return err.message;
    }
  }
  if (err instanceof Error && err.name === "ZodError") return t("dir.zod");
  if (err instanceof TypeError) return t("dir.unreachable");
  return String(err);
}

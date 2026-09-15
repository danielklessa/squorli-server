import { z } from "zod";
import { Iso, PublicKey, Signature, Uuid } from "./primitives";

// COPY NOTE: this file (like primitives.ts, backup.ts, useragent.ts including their tests) also exists byte-identically in the
// squorli-directory repo under packages/protocol/src. The source is squorli-server; copy it over after every change (see AGENTS.md).

/** Challenge-response sign-in with Ed25519: chat server (/api/auth/challenge) and directory service (/api/challenge) use the same shape. */
export const ChallengeRequest = z.object({ publicKey: PublicKey });
export const ChallengeResponse = z.object({
  challengeId: Uuid,
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: Iso,
});
export type ChallengeResponse = z.infer<typeof ChallengeResponse>;

/**
 * Contract of the directory service (PLAN 3.2 / M6, brought forward on 2026-09-14):
 * Handle (@name) -> public key. The service is deliberately narrow; chat servers query it only
 * optionally and tolerate its outage (the key then applies without a handle).
 *
 * M6a: registration and resolution. M6b: encrypted key backup.
 * M6c: TOTP authenticator and recovery codes as a second factor for key retrieval, signed account actions,
 * list of key retrievals. SMTP remains prepared.
 */

/** Handle without @: 3-32 characters, lowercase letters, digits, dot, underscore; starts and ends alphanumeric. */
export const Handle = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9_.]*[a-z0-9])?$/, "3-32 Zeichen: a-z, 0-9, Punkt, Unterstrich");

/** Registration is bound to the service's host (like sign-in is to PUBLIC_DOMAIN) so signatures cannot be moved elsewhere. */
export function directoryRegisterMessage(directoryHost: string, handle: string, nonce: string): string {
  return `community-directory-register\n${directoryHost}\n${handle}\n${nonce}`;
}

export const DirectoryRegisterRequest = z.object({
  handle: Handle,
  publicKey: PublicKey,
  challengeId: Uuid,
  signature: Signature,
});

/** Display name (chat server: per server, PLAN 3.2; directory: global and per server). Empty = handle or the short form of the key. */
export const DisplayName = z.string().trim().min(1).max(32);
/** Host of a chat server (PUBLIC_DOMAIN, with port if any), the key for per-server display names in the directory. */
export const ServerHost = z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/, "Hostname, optional mit Port");

export const DirectoryAccount = z.object({
  handle: Handle,
  publicKey: PublicKey,
  createdAt: Iso,
  /** M6b: a password backup exists (signing in on other devices is possible). */
  hasBackup: z.boolean().default(false),
  /** Global display name; only for registered chat servers (server token, `?server=<host>`), always null publicly. */
  displayName: DisplayName.nullable().default(null),
  /** Display name for exactly the server from `?server=<host>` (only with its token); null if there is no entry. Takes precedence over `displayName`. */
  serverDisplayName: DisplayName.nullable().default(null),
});

// ---- M6b: password-encrypted key backup (crypto in backup.ts)
const Hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`), `${bytes * 2} hex chars`);

/** Parameters of the backup, chosen by the client; the service only passes them through (iv is in the blob only, not in the parameter query). */
export const BackupParams = z.object({
  kdf: z.literal("pbkdf2-sha256"),
  iterations: z.number().int().min(100_000).max(10_000_000),
  salt: Hex(16),
  iv: Hex(12),
});
/** Auth key derived from the password; grants retrieval of the ciphertext, the service stores only its SHA-256. */
export const BackupAuthKey = Hex(32);
/** Storing is bound to host + challenge like registration and also covers the ciphertext. */
export function directoryBackupMessage(directoryHost: string, nonce: string, ciphertext: string): string {
  return `community-directory-backup\n${directoryHost}\n${nonce}\n${ciphertext}`;
}
// ---- M6c: second factor. 6 digits = TOTP code, otherwise a recovery code (xxxxx-xxxxx); the service decides by shape.
export const SecondFactorCode = z.string().trim().min(6).max(20);

export const BackupUploadRequest = z.object({
  publicKey: PublicKey,
  challengeId: Uuid,
  signature: Signature,
  /** base64, AES-GCM over the 32-byte seed (48 bytes). */
  ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(512),
  params: BackupParams,
  authKey: BackupAuthKey,
  /** M6c: mandatory when the authenticator is active (changing the password = replacing the backup). */
  code: SecondFactorCode.optional(),
});
/** First step of recovery: salt and iterations so the client can derive the auth key. */
export const BackupParamsResponse = BackupParams.omit({ iv: true });
/** Second step; `code` is only needed after a 401 totp_required (the response only comes with the correct password). */
export const BackupFetchRequest = z.object({ handle: Handle, authKey: BackupAuthKey, code: SecondFactorCode.optional() });
export const BackupBlob = z.object({ handle: Handle, publicKey: PublicKey, ciphertext: z.string(), params: BackupParams, updatedAt: Iso });

// ---- M6c: signed account actions (authenticator, recovery codes, account status). Same pattern as registration
// and backup: challenge + signature over host, nonce and payload (for actions with a code, the code is the payload).
export const DirectoryAction = z.enum(["totp-setup", "totp-enable", "totp-disable", "recovery-regenerate", "account-status", "profile-update", "friends"]);
export type DirectoryAction = z.infer<typeof DirectoryAction>;
export function directoryActionMessage(directoryHost: string, action: DirectoryAction, nonce: string, payload = ""): string {
  return `community-directory-${action}\n${directoryHost}\n${nonce}\n${payload}`;
}
export const SignedActionRequest = z.object({ publicKey: PublicKey, challengeId: Uuid, signature: Signature });
export const CodeActionRequest = SignedActionRequest.extend({ code: SecondFactorCode });

// ---- Display names in the directory: global (server = null) or per chat server (server = that server's host). Registered chat servers
// fetch `GET /api/keys/<key>?server=<host>` on sign-in (with their server token) and adopt serverDisplayName ?? displayName.
// The signature's payload is "<server|empty>\n<name|empty>" so that neither server nor name can be swapped out.
export function directoryProfilePayload(server: string | null, displayName: string | null): string {
  return `${server ?? ""}\n${displayName ?? ""}`;
}
export const ProfileUpdateRequest = SignedActionRequest.extend({ server: ServerHost.nullable(), displayName: DisplayName.nullable() });
/** A chat server that has looked up the key (a sign-in there), with the display name that applies there (account page). `verified` = registered with the directory. */
export const AccountServer = z.object({
  host: ServerHost, name: z.string().nullable(), displayName: DisplayName.nullable(), lastSeenAt: Iso, verified: z.boolean().default(false),
  /** The server's icon at the directory (M6d): time it was last taken over, null = none. URL: directoryServerIconUrl(). */
  iconUpdatedAt: Iso.nullable().default(null),
});

// ---- Server registration: a chat server proves its key (signature over host + nonce) and control over
// its host (the directory reads `proofUrl`, the server's /api/health, and compares `serverKey`). After that it may use the
// token (bearer, 24 h, re-register on a 401) to read the handle and display name of its users; without a token there is only handle + key.
export function directoryServerRegisterMessage(directoryHost: string, host: string, nonce: string): string {
  return `community-directory-server-register\n${directoryHost}\n${host}\n${nonce}`;
}
export const ServerRegisterRequest = z.object({
  host: ServerHost,
  name: z.string().trim().max(80).nullable().default(null),
  publicKey: PublicKey,
  challengeId: Uuid,
  signature: Signature,
  /** The chat server's /api/health; must point at `host` (https; http only for localhost/127.0.0.1) and return `serverKey` = publicKey. */
  proofUrl: z.string().url(),
  /** Server directory (M6d): list publicly? Plus description, open join and member count (display only). */
  listed: z.boolean().default(false),
  description: z.string().trim().max(200).nullable().default(null),
  openJoin: z.boolean().default(false),
  memberCount: z.number().int().min(0).nullable().default(null),
});
/**
 * Entry in the public server directory (M6d, GET /api/servers: only servers with `listed` whose token has not expired).
 * The directory fetches the icon itself from <proofUrl base>/api/server-icon on every registration (the host is proven) and
 * serves it under GET /api/servers/<host>/icon; so clients load icons only from the directory, never from foreign servers.
 */
export const DirectoryServer = z.object({
  host: ServerHost,
  name: z.string().nullable(),
  description: z.string().nullable(),
  openJoin: z.boolean(),
  memberCount: z.number().int().nullable(),
  iconUpdatedAt: Iso.nullable(),
  registeredAt: Iso,
});
export const ServerListResponse = z.array(DirectoryServer);
/** URL of the server icon at the directory (with a version parameter, cacheable for a long time); null = no icon. */
export function directoryServerIconUrl(dirUrl: string, host: string, iconUpdatedAt: string | null): string | null {
  return iconUpdatedAt ? `${dirUrl}/api/servers/${encodeURIComponent(host)}/icon?v=${Date.parse(iconUpdatedAt)}` : null;
}
/** Link to the chat server: https, except for localhost/127.0.0.1 (dev). */
export function directoryServerUrl(host: string): string {
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https"}://${host}`;
}
export const ServerRegisterResponse = z.object({ host: ServerHost, token: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: Iso });
/** Bulk query by a registered server (bearer token): handle + names for many keys at once (periodic reconciliation). Unknown keys are absent from the response. */
export const ServerResolveRequest = z.object({ publicKeys: z.array(PublicKey).min(1).max(200) });
export const ServerResolveResponse = z.array(DirectoryAccount);
/**
 * Push from the directory to a registered chat server (POST <proofUrl base>/api/directory/notify) after a name change:
 * only the key, no data. The server fetches the state itself with its token (which is why the push needs no signature;
 * a stranger can at most trigger a superfluous fetch).
 */
export const DirectoryNotifyRequest = z.object({ publicKey: PublicKey });
export type ServerResolveRequest = z.infer<typeof ServerResolveRequest>;
export type ServerRegisterRequest = z.infer<typeof ServerRegisterRequest>;
export type ServerRegisterResponse = z.infer<typeof ServerRegisterResponse>;
export type DirectoryServer = z.infer<typeof DirectoryServer>;

/** Response to totp-setup: secret (base32, 20 bytes) for the QR code and for typing in; it only becomes active with totp-enable. */
export const TotpSetupResponse = z.object({ secret: z.string().regex(/^[A-Z2-7]{32}$/), otpauth: z.string().url(), issuer: z.string() });
/** Recovery codes are shown in plain text exactly once; the service stores hashes only. */
export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(z.string()).length(10) });
/** One key retrieval via backup (M6c, display only): when, which browser, from which site, with which factor. */
export const KeyFetch = z.object({
  at: Iso,
  label: z.string().nullable(),
  origin: z.string().nullable(),
  factor: z.enum(["password", "totp", "recovery"]),
});
export const AccountStatus = DirectoryAccount.extend({
  totpEnabled: z.boolean(),
  /** Secret generated but not yet confirmed with a code. */
  totpPending: z.boolean(),
  recoveryCodesLeft: z.number().int().min(0),
  fetches: z.array(KeyFetch),
  servers: z.array(AccountServer),
});

export const DirectoryHealth = z.object({
  ok: z.literal(true),
  service: z.literal("directory"),
  /** Host that registration signatures are bound to. */
  host: z.string(),
  /** `friends` (M7): friends and direct messages over the WebSocket /api/ws. */
  features: z.object({ backup: z.boolean(), totp: z.boolean(), email: z.boolean(), friends: z.boolean().default(false) }),
  time: Iso,
});

export type DirectoryRegisterRequest = z.infer<typeof DirectoryRegisterRequest>;
export type DirectoryAccount = z.infer<typeof DirectoryAccount>;
export type DirectoryHealth = z.infer<typeof DirectoryHealth>;
export type BackupParams = z.infer<typeof BackupParams>;
export type BackupUploadRequest = z.infer<typeof BackupUploadRequest>;
export type BackupBlob = z.infer<typeof BackupBlob>;
export type TotpSetupResponse = z.infer<typeof TotpSetupResponse>;
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponse>;
export type KeyFetch = z.infer<typeof KeyFetch>;
export type AccountStatus = z.infer<typeof AccountStatus>;
export type AccountServer = z.infer<typeof AccountServer>;

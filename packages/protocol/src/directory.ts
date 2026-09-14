import { z } from "zod";
import { Iso, PublicKey, Signature, Uuid } from "./primitives";

// KOPIE-HINWEIS: Diese Datei (wie primitives.ts, backup.ts, useragent.ts samt Tests) liegt byte-identisch auch im Repo
// squorli-directory unter packages/protocol/src. Quelle ist squorli-server; nach jeder Aenderung dorthin kopieren (siehe AGENTS.md).

/** Challenge-Response-Anmeldung mit Ed25519: Chat-Server (/api/auth/challenge) und Verzeichnisdienst (/api/challenge) nutzen dieselbe Form. */
export const ChallengeRequest = z.object({ publicKey: PublicKey });
export const ChallengeResponse = z.object({
  challengeId: Uuid,
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: Iso,
});
export type ChallengeResponse = z.infer<typeof ChallengeResponse>;

/**
 * Vertrag des Verzeichnisdienstes (PLAN 3.2 / M6, vorgezogen am 14.09.2026):
 * Handle (@name) -> oeffentlicher Schluessel. Der Dienst ist bewusst schmal; Chat-Server fragen ihn nur
 * optional und tolerieren seinen Ausfall (dann gilt der Schluessel ohne Handle).
 *
 * M6a: Registrierung und Aufloesung. M6b: verschluesseltes Schluessel-Backup.
 * M6c: TOTP-Authenticator und Wiederherstellungscodes als zweiter Faktor fuer den Schluesselabruf, signierte Kontoaktionen,
 * Liste der Schluesselabrufe. SMTP bleibt vorbereitet.
 */

/** Handle ohne @: 3-32 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Unterstrich; beginnt und endet alphanumerisch. */
export const Handle = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9_.]*[a-z0-9])?$/, "3-32 Zeichen: a-z, 0-9, Punkt, Unterstrich");

/** Registrierung ist an den Host des Dienstes gebunden (wie der Login an PUBLIC_DOMAIN), damit Signaturen nicht wanderbar sind. */
export function directoryRegisterMessage(directoryHost: string, handle: string, nonce: string): string {
  return `community-directory-register\n${directoryHost}\n${handle}\n${nonce}`;
}

export const DirectoryRegisterRequest = z.object({
  handle: Handle,
  publicKey: PublicKey,
  challengeId: Uuid,
  signature: Signature,
});

export const DirectoryAccount = z.object({
  handle: Handle,
  publicKey: PublicKey,
  createdAt: Iso,
  /** M6b: Passwort-Backup vorhanden (Anmeldung auf anderen Geraeten moeglich). */
  hasBackup: z.boolean().default(false),
});

// ---- M6b: passwortverschluesseltes Schluessel-Backup (Krypto in backup.ts)
const Hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`), `${bytes * 2} hex chars`);

/** Parameter des Backups, vom Client festgelegt; der Dienst reicht sie nur durch (iv ist nur im Blob, nicht in der Parameter-Abfrage). */
export const BackupParams = z.object({
  kdf: z.literal("pbkdf2-sha256"),
  iterations: z.number().int().min(100_000).max(10_000_000),
  salt: Hex(16),
  iv: Hex(12),
});
/** Aus dem Passwort abgeleiteter Auth-Schluessel; berechtigt zum Abruf des Chiffretexts, der Dienst speichert nur seinen SHA-256. */
export const BackupAuthKey = Hex(32);
/** Ablegen ist wie die Registrierung an Host + Challenge gebunden und deckt den Chiffretext mit ab. */
export function directoryBackupMessage(directoryHost: string, nonce: string, ciphertext: string): string {
  return `community-directory-backup\n${directoryHost}\n${nonce}\n${ciphertext}`;
}
// ---- M6c: zweiter Faktor. 6 Ziffern = TOTP-Code, sonst Wiederherstellungscode (xxxxx-xxxxx); der Dienst entscheidet nach Form.
export const SecondFactorCode = z.string().trim().min(6).max(20);

export const BackupUploadRequest = z.object({
  publicKey: PublicKey,
  challengeId: Uuid,
  signature: Signature,
  /** base64, AES-GCM ueber den 32-Byte-Seed (48 Byte). */
  ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(512),
  params: BackupParams,
  authKey: BackupAuthKey,
  /** M6c: Pflicht, wenn der Authenticator aktiv ist (Passwort aendern = Backup ersetzen). */
  code: SecondFactorCode.optional(),
});
/** Erster Schritt der Wiederherstellung: Salt und Iterationen, damit der Client den Auth-Schluessel ableiten kann. */
export const BackupParamsResponse = BackupParams.omit({ iv: true });
/** Zweiter Schritt; `code` erst nach 401 totp_required noetig (die Antwort kommt nur bei richtigem Passwort). */
export const BackupFetchRequest = z.object({ handle: Handle, authKey: BackupAuthKey, code: SecondFactorCode.optional() });
export const BackupBlob = z.object({ handle: Handle, publicKey: PublicKey, ciphertext: z.string(), params: BackupParams, updatedAt: Iso });

// ---- M6c: signierte Kontoaktionen (Authenticator, Wiederherstellungscodes, Kontostatus). Gleiches Muster wie Registrierung
// und Backup: Challenge + Signatur ueber Host, Nonce und Nutzlast (bei Aktionen mit Code ist der Code die Nutzlast).
export const DirectoryAction = z.enum(["totp-setup", "totp-enable", "totp-disable", "recovery-regenerate", "account-status"]);
export type DirectoryAction = z.infer<typeof DirectoryAction>;
export function directoryActionMessage(directoryHost: string, action: DirectoryAction, nonce: string, payload = ""): string {
  return `community-directory-${action}\n${directoryHost}\n${nonce}\n${payload}`;
}
export const SignedActionRequest = z.object({ publicKey: PublicKey, challengeId: Uuid, signature: Signature });
export const CodeActionRequest = SignedActionRequest.extend({ code: SecondFactorCode });

/** Antwort auf totp-setup: Geheimnis (base32, 20 Byte) fuer QR-Code und Abtippen; aktiv wird es erst mit totp-enable. */
export const TotpSetupResponse = z.object({ secret: z.string().regex(/^[A-Z2-7]{32}$/), otpauth: z.string().url(), issuer: z.string() });
/** Wiederherstellungscodes werden genau einmal im Klartext gezeigt; der Dienst speichert nur Hashes. */
export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(z.string()).length(10) });
/** Ein Schluesselabruf per Backup (M6c, nur Anzeige): wann, welcher Browser, von welcher Seite, mit welchem Faktor. */
export const KeyFetch = z.object({
  at: Iso,
  label: z.string().nullable(),
  origin: z.string().nullable(),
  factor: z.enum(["password", "totp", "recovery"]),
});
export const AccountStatus = DirectoryAccount.extend({
  totpEnabled: z.boolean(),
  /** Geheimnis erzeugt, aber noch nicht mit einem Code bestaetigt. */
  totpPending: z.boolean(),
  recoveryCodesLeft: z.number().int().min(0),
  fetches: z.array(KeyFetch),
});

export const DirectoryHealth = z.object({
  ok: z.literal(true),
  service: z.literal("directory"),
  /** Host, an den Registrierungs-Signaturen gebunden sind. */
  host: z.string(),
  features: z.object({ backup: z.boolean(), totp: z.boolean(), email: z.boolean() }),
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

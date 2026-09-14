// KOPIE-HINWEIS: liegt byte-identisch auch im Repo squorli-directory (packages/protocol/src); Quelle ist squorli-server, nach Aenderung kopieren.
/**
 * Schluessel-Backup (M6b): Der private Schluessel (32-Byte-Seed des Ed25519-Paares) wird im Client mit einem Passwort
 * verschluesselt. Der Verzeichnisdienst sieht nur Chiffretext und einen Auth-Schluessel, der zum Abrufen berechtigt
 * (dort nur als SHA-256 gespeichert). Isomorph: WebCrypto in Browser und Node, keine Abhaengigkeiten.
 *
 * Ableitung:  PBKDF2-SHA256(passwort, salt, iterations)      -> master (32 Byte)
 *             HKDF-SHA256(master, info "community-backup-enc") -> AES-256-GCM-Schluessel (verlaesst den Client nie)
 *             HKDF-SHA256(master, info "community-backup-auth")-> Auth-Schluessel (hex, wird an den Dienst gesendet)
 * Wer die Datenbank des Dienstes hat, muss trotzdem das Passwort durch PBKDF2 raten; wer den Auth-Schluessel abfaengt,
 * bekommt nur den Chiffretext.
 */
import type { BackupParams } from "./directory";

export const BACKUP_ITERATIONS = 600_000;
export const BACKUP_MIN_PASSWORD = 8;

const utf8 = (s: string) => new TextEncoder().encode(s);
const subtle = () => globalThis.crypto.subtle;

export const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
// Rueckgabetyp bewusst nicht annotiert: new Uint8Array(n) ist Uint8Array<ArrayBuffer>, was WebCrypto (BufferSource) verlangt.
export const hexToBytes = (h: string) => {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const bytesToBase64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
export const base64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const randomHex = (bytes: number): string => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

export type BackupKeys = { encKey: CryptoKey; authKey: string };

/** Beide Schluessel aus Passwort und Parametern ableiten (dauert wegen PBKDF2 absichtlich einen Moment). */
export async function deriveBackupKeys(password: string, saltHex: string, iterations: number): Promise<BackupKeys> {
  const s = subtle();
  const base = await s.importKey("raw", utf8(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await s.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, base, 256);
  const hk = await s.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const hkdf = (info: string) => s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) }, hk, 256);
  const encKey = await s.importKey("raw", await hkdf("community-backup-enc"), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { encKey, authKey: bytesToHex(new Uint8Array(await hkdf("community-backup-auth"))) };
}

/** Neues Backup: frisches Salt und IV, Seed mit AES-GCM verschluesseln. */
export async function createBackup(password: string, privateKeyHex: string, iterations = BACKUP_ITERATIONS): Promise<{ params: BackupParams; ciphertext: string; authKey: string }> {
  const params: BackupParams = { kdf: "pbkdf2-sha256", iterations, salt: randomHex(16), iv: randomHex(12) };
  const keys = await deriveBackupKeys(password, params.salt, params.iterations);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: hexToBytes(params.iv) }, keys.encKey, hexToBytes(privateKeyHex));
  return { params, ciphertext: bytesToBase64(new Uint8Array(ct)), authKey: keys.authKey };
}

/** Backup oeffnen; wirft bei falschem Schluessel (AES-GCM-Tag passt nicht). Liefert den Seed als Hex. */
export async function openBackup(keys: BackupKeys, ivHex: string, ciphertext: string): Promise<string> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: hexToBytes(ivHex) }, keys.encKey, base64ToBytes(ciphertext));
  return bytesToHex(new Uint8Array(pt));
}

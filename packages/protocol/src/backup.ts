// COPY NOTE: also exists byte-identically in the squorli-directory repo (packages/protocol/src); the source is squorli-server, copy it over after any change.
/**
 * Key backup (M6b): the private key (32-byte seed of the Ed25519 pair) is encrypted in the client with a password.
 * The directory service only sees ciphertext and an auth key that grants retrieval
 * (stored there as SHA-256 only). Isomorphic: WebCrypto in browser and Node, no dependencies.
 *
 * Derivation: PBKDF2-SHA256(password, salt, iterations)      -> master (32 bytes)
 *             HKDF-SHA256(master, info "community-backup-enc") -> AES-256-GCM key (never leaves the client)
 *             HKDF-SHA256(master, info "community-backup-auth")-> auth key (hex, sent to the service)
 * Whoever has the service's database still has to guess the password through PBKDF2; whoever intercepts the auth key
 * only gets the ciphertext.
 */
import type { BackupParams } from "./directory";

export const BACKUP_ITERATIONS = 600_000;
export const BACKUP_MIN_PASSWORD = 8;

const utf8 = (s: string) => new TextEncoder().encode(s);
const subtle = () => globalThis.crypto.subtle;

export const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
// Return type deliberately not annotated: new Uint8Array(n) is Uint8Array<ArrayBuffer>, which is what WebCrypto (BufferSource) requires.
export const hexToBytes = (h: string) => {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const bytesToBase64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
export const base64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const randomHex = (bytes: number): string => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

export type BackupKeys = { encKey: CryptoKey; authKey: string };

/** Derive both keys from password and parameters (deliberately takes a moment because of PBKDF2). */
export async function deriveBackupKeys(password: string, saltHex: string, iterations: number): Promise<BackupKeys> {
  const s = subtle();
  const base = await s.importKey("raw", utf8(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await s.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, base, 256);
  const hk = await s.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const hkdf = (info: string) => s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) }, hk, 256);
  const encKey = await s.importKey("raw", await hkdf("community-backup-enc"), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { encKey, authKey: bytesToHex(new Uint8Array(await hkdf("community-backup-auth"))) };
}

/** New backup: fresh salt and IV, encrypt the seed with AES-GCM. */
export async function createBackup(password: string, privateKeyHex: string, iterations = BACKUP_ITERATIONS): Promise<{ params: BackupParams; ciphertext: string; authKey: string }> {
  const params: BackupParams = { kdf: "pbkdf2-sha256", iterations, salt: randomHex(16), iv: randomHex(12) };
  const keys = await deriveBackupKeys(password, params.salt, params.iterations);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: hexToBytes(params.iv) }, keys.encKey, hexToBytes(privateKeyHex));
  return { params, ciphertext: bytesToBase64(new Uint8Array(ct)), authKey: keys.authKey };
}

/** Open a backup; throws on a wrong key (the AES-GCM tag does not match). Returns the seed as hex. */
export async function openBackup(keys: BackupKeys, ivHex: string, ciphertext: string): Promise<string> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: hexToBytes(ivHex) }, keys.encKey, base64ToBytes(ciphertext));
  return bytesToHex(new Uint8Array(pt));
}

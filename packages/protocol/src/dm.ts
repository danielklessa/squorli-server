// COPY NOTE: also exists byte-identically in the squorli-directory repo (packages/protocol/src); the source is squorli-server, copy it over after any change.
/**
 * End-to-end encryption of direct messages (M7). Isomorphic (browser, Node, account page).
 *
 * Key: the Ed25519 identity key, converted to X25519 (the same conversion as libsodium's
 * crypto_sign_ed25519_*_to_curve25519). Each side knows the friend's Ed25519 key from the directory, so no key
 * distribution is needed. Both sides (and all their devices, the seed lives in the backup) derive the same
 * pair key:
 *
 *   shared = X25519(meinX, deinX)
 *   key    = HKDF-SHA256(shared, salt = smaller Ed25519 key ‖ larger one, info "squorli-dm-v1") -> AES-256-GCM
 *
 * Message: AES-GCM(key, random 12-byte IV, JSON { text }, AAD = "v1\n<from>\n<to>\n<id>"). The AAD binds sender,
 * recipient and message id so the directory cannot swap anything around; authenticity follows from the DH (only the two
 * key holders can produce a valid tag). No forward secrecy (deliberate, PLAN-friends-dm.md §8).
 */
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, randomHex } from "./backup";

const utf8 = (s: string) => new TextEncoder().encode(s);
const subtle = () => globalThis.crypto.subtle;

export const DM_VERSION = "v1";
/** Plaintext of a message; deliberately an object so fields (reply-to, attachments) can be added later. */
export type DmPlaintext = { text: string };

/** X25519 counterpart of a friend's Ed25519 key (hex). */
export function dmPublicKeyOf(ed25519PublicKeyHex: string): string {
  return bytesToHex(ed25519.utils.toMontgomery(hexToBytes(ed25519PublicKeyHex)));
}

/** Additional data (AAD) of a message; the directory knows these values too but cannot change them without breaking the tag. */
export function dmAad(from: string, to: string, id: string): string {
  return `${DM_VERSION}\n${from}\n${to}\n${id}`;
}

/** Pair key from my seed and the friend's Ed25519 key; cache it per friend in the client. */
export async function deriveDmKey(mySeedHex: string, myPublicKeyHex: string, theirPublicKeyHex: string): Promise<CryptoKey> {
  const myX = ed25519.utils.toMontgomerySecret(hexToBytes(mySeedHex));
  const shared = x25519.getSharedSecret(myX, hexToBytes(dmPublicKeyOf(theirPublicKeyHex)));
  const [lo, hi] = [myPublicKeyHex, theirPublicKeyHex].sort();
  const hk = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: utf8(`${lo}${hi}`), info: utf8("squorli-dm-v1") }, hk, 256);
  return subtle().importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypt a message: fresh IV, plaintext as JSON. */
export async function sealDm(key: CryptoKey, from: string, to: string, id: string, plaintext: DmPlaintext): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomHex(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: hexToBytes(iv), additionalData: utf8(dmAad(from, to, id)) }, key, utf8(JSON.stringify(plaintext)));
  return { iv, ciphertext: bytesToBase64(new Uint8Array(ct)) };
}

/** Decrypt a message; throws on a wrong key or modified fields (the AES-GCM tag does not match). */
export async function openDm(key: CryptoKey, m: { from: string; to: string; id: string; iv: string; ciphertext: string }): Promise<DmPlaintext> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: hexToBytes(m.iv), additionalData: utf8(dmAad(m.from, m.to, m.id)) }, key, base64ToBytes(m.ciphertext));
  const parsed = JSON.parse(new TextDecoder().decode(pt)) as Partial<DmPlaintext>;
  return { text: typeof parsed.text === "string" ? parsed.text : "" };
}

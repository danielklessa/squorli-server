// KOPIE-HINWEIS: liegt byte-identisch auch im Repo squorli-directory (packages/protocol/src); Quelle ist squorli-server, nach Aenderung kopieren.
/**
 * Ende-zu-Ende-Verschluesselung der Direktnachrichten (M7). Isomorph (Browser, Node, Kontoseite).
 *
 * Schluessel: der Ed25519-Identitaetsschluessel, nach X25519 umgerechnet (dieselbe Umrechnung wie libsodium
 * crypto_sign_ed25519_*_to_curve25519). Jede Seite kennt den Ed25519-Schluessel des Freundes vom Verzeichnis, also braucht
 * es keine Schluesselverteilung. Beide Seiten (und alle ihre Geraete, der Seed liegt im Backup) leiten denselben
 * Paarschluessel ab:
 *
 *   shared = X25519(meinX, deinX)
 *   key    = HKDF-SHA256(shared, salt = kleinerer Ed25519-Schluessel ‖ groesserer, info "squorli-dm-v1") -> AES-256-GCM
 *
 * Nachricht: AES-GCM(key, zufaellige 12-Byte-IV, JSON { text }, AAD = "v1\n<from>\n<to>\n<id>"). Das AAD bindet Absender,
 * Empfaenger und Nachrichten-ID, damit das Verzeichnis nichts vertauschen kann; Echtheit folgt aus dem DH (nur die beiden
 * Schluesselinhaber koennen ein gueltiges Tag erzeugen). Keine Forward Secrecy (bewusst, PLAN-friends-dm.md §8).
 */
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, randomHex } from "./backup";

const utf8 = (s: string) => new TextEncoder().encode(s);
const subtle = () => globalThis.crypto.subtle;

export const DM_VERSION = "v1";
/** Klartext einer Nachricht; bewusst ein Objekt, damit spaeter Felder (Antwort auf, Anhaenge) dazukommen koennen. */
export type DmPlaintext = { text: string };

/** X25519-Gegenstueck des Ed25519-Schluessels eines Freundes (hex). */
export function dmPublicKeyOf(ed25519PublicKeyHex: string): string {
  return bytesToHex(ed25519.utils.toMontgomery(hexToBytes(ed25519PublicKeyHex)));
}

/** Zusatzdaten (AAD) einer Nachricht; auch das Verzeichnis kennt die Werte, kann sie aber nicht aendern, ohne das Tag zu brechen. */
export function dmAad(from: string, to: string, id: string): string {
  return `${DM_VERSION}\n${from}\n${to}\n${id}`;
}

/** Paarschluessel aus meinem Seed und dem Ed25519-Schluessel des Freundes; im Client je Freund zwischenspeichern. */
export async function deriveDmKey(mySeedHex: string, myPublicKeyHex: string, theirPublicKeyHex: string): Promise<CryptoKey> {
  const myX = ed25519.utils.toMontgomerySecret(hexToBytes(mySeedHex));
  const shared = x25519.getSharedSecret(myX, hexToBytes(dmPublicKeyOf(theirPublicKeyHex)));
  const [lo, hi] = [myPublicKeyHex, theirPublicKeyHex].sort();
  const hk = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: utf8(`${lo}${hi}`), info: utf8("squorli-dm-v1") }, hk, 256);
  return subtle().importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Nachricht verschluesseln: frische IV, Klartext als JSON. */
export async function sealDm(key: CryptoKey, from: string, to: string, id: string, plaintext: DmPlaintext): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomHex(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: hexToBytes(iv), additionalData: utf8(dmAad(from, to, id)) }, key, utf8(JSON.stringify(plaintext)));
  return { iv, ciphertext: bytesToBase64(new Uint8Array(ct)) };
}

/** Nachricht entschluesseln; wirft bei falschem Schluessel oder veraenderten Feldern (AES-GCM-Tag passt nicht). */
export async function openDm(key: CryptoKey, m: { from: string; to: string; id: string; iv: string; ciphertext: string }): Promise<DmPlaintext> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: hexToBytes(m.iv), additionalData: utf8(dmAad(m.from, m.to, m.id)) }, key, base64ToBytes(m.ciphertext));
  const parsed = JSON.parse(new TextDecoder().decode(pt)) as Partial<DmPlaintext>;
  return { text: typeof parsed.text === "string" ? parsed.text : "" };
}

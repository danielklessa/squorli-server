/**
 * Identity = Ed25519 key pair, generated in the browser, stored in localStorage.
 *
 * M0: unencrypted in localStorage. That is fine for development and
 * NOT sufficient for release 1. Before M5: recovery code + encrypted storage.
 */
import * as ed from "@noble/ed25519";

const KEY = "chat.identity.v1";

export type Identity = { publicKey: string; privateKey: string };

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)));

export async function loadOrCreateIdentity(): Promise<Identity> {
  const raw = localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw) as Identity;
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const id: Identity = { publicKey: toHex(pub), privateKey: toHex(priv) };
  localStorage.setItem(KEY, JSON.stringify(id));
  return id;
}

export function forgetIdentity() {
  localStorage.removeItem(KEY);
}

/** M6b: identity from a recovered seed (sign-in with handle + password). */
export async function identityFromPrivateKey(privateKeyHex: string): Promise<Identity> {
  const pub = await ed.getPublicKeyAsync(fromHex(privateKeyHex));
  return { publicKey: toHex(pub), privateKey: privateKeyHex };
}

/** Replace the device key (after a recovery). */
export function storeIdentity(id: Identity) {
  localStorage.setItem(KEY, JSON.stringify(id));
}

export async function sign(id: Identity, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), fromHex(id.privateKey));
  return toHex(sig);
}

// ---------- Server accounts (`~name`, docs/features/local-accounts.md): one key of its own per server, next to the main identity
// above (the directory account's key, or this device's). The session token of such a server lives here too, so switching the
// main identity (another directory account) never touches them.
const SERVER_ACCOUNTS = "chat.serverAccounts.v1";

export type ServerAccount = Identity & { localHandle: string; token: string | null };

export function loadServerAccounts(): Record<string, ServerAccount> {
  try {
    const raw = localStorage.getItem(SERVER_ACCOUNTS);
    return raw ? (JSON.parse(raw) as Record<string, ServerAccount>) : {};
  } catch { return {}; }
}
function saveServerAccounts(all: Record<string, ServerAccount>) {
  try { localStorage.setItem(SERVER_ACCOUNTS, JSON.stringify(all)); } catch { /* no storage: the account lasts this page */ }
}
export function storeServerAccount(host: string, account: ServerAccount) { saveServerAccounts({ ...loadServerAccounts(), [host]: account }); }
export function forgetServerAccount(host: string) { const all = loadServerAccounts(); delete all[host]; saveServerAccounts(all); }

/** A fresh key pair that is not stored anywhere yet (a new server account). */
export async function newIdentity(): Promise<Identity> {
  const priv = ed.utils.randomPrivateKey();
  return { publicKey: toHex(await ed.getPublicKeyAsync(priv)), privateKey: toHex(priv) };
}

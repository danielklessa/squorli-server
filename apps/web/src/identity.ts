/**
 * Identity = Ed25519 key pair, generated in the browser. Stored in localStorage (browser) or, in the desktop app, encrypted
 * by the operating system (`safeStorage`, 25 September 2026: `setSecretStore`, moved over from localStorage at the first
 * read). A browser page has no such store: there the key stays unencrypted in localStorage. No mnemonic recovery code (user's decision,
 * 25 September 2026): the password-encrypted key backup at the directory and
 * server accounts replace it.
 */
import * as ed from "@noble/ed25519";

const KEY = "chat.identity.v1";

type SecretStore = { get(key: string): string | null; set(key: string, value: string | null): boolean };
let secretStore: SecretStore | null = null;
/** Where the platform keeps secrets encrypted (platform.secretStore); null = localStorage. Set once at start (main.tsx). */
export function setSecretStore(store: SecretStore | null) { secretStore = store; }

/**
 * Read a secret. With a secret store, a value still in localStorage (an app from before, or the browser storage of this
 * origin) is moved over: written there, read back, and only then removed from localStorage.
 */
function readSecret(key: string): string | null {
  if (!secretStore) return localStorage.getItem(key);
  const stored = secretStore.get(key);
  if (stored !== null) return stored;
  const legacy = localStorage.getItem(key);
  if (legacy !== null && secretStore.set(key, legacy) && secretStore.get(key) === legacy) localStorage.removeItem(key);
  return legacy;
}
function writeSecret(key: string, value: string | null) {
  if (secretStore && secretStore.set(key, value)) { localStorage.removeItem(key); return; }
  if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
}

export type Identity = { publicKey: string; privateKey: string };

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)));

export async function loadOrCreateIdentity(): Promise<Identity> {
  const raw = readSecret(KEY);
  if (raw) return JSON.parse(raw) as Identity;
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const id: Identity = { publicKey: toHex(pub), privateKey: toHex(priv) };
  writeSecret(KEY, JSON.stringify(id));
  return id;
}

export function forgetIdentity() {
  writeSecret(KEY, null);
}

/** M6b: identity from a recovered seed (sign-in with handle + password). */
export async function identityFromPrivateKey(privateKeyHex: string): Promise<Identity> {
  const pub = await ed.getPublicKeyAsync(fromHex(privateKeyHex));
  return { publicKey: toHex(pub), privateKey: privateKeyHex };
}

/** Replace the device key (after a recovery). */
export function storeIdentity(id: Identity) {
  writeSecret(KEY, JSON.stringify(id));
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
    const raw = readSecret(SERVER_ACCOUNTS);
    return raw ? (JSON.parse(raw) as Record<string, ServerAccount>) : {};
  } catch { return {}; }
}
function saveServerAccounts(all: Record<string, ServerAccount>) {
  try { writeSecret(SERVER_ACCOUNTS, JSON.stringify(all)); } catch { /* no storage: the account lasts this page */ }
}
export function storeServerAccount(host: string, account: ServerAccount) { saveServerAccounts({ ...loadServerAccounts(), [host]: account }); }
export function forgetServerAccount(host: string) { const all = loadServerAccounts(); delete all[host]; saveServerAccounts(all); }

/** A fresh key pair that is not stored anywhere yet (a new server account). */
export async function newIdentity(): Promise<Identity> {
  const priv = ed.utils.randomPrivateKey();
  return { publicKey: toHex(await ed.getPublicKeyAsync(priv)), privateKey: toHex(priv) };
}

import { ipcMain, safeStorage, type IpcMainEvent } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IPC, SECRET_KEYS } from "@squorli/web/platform/bridge";

/**
 * The client's secrets (the identity key, the server accounts' keys and tokens), encrypted with the operating system's key
 * store through Electron's `safeStorage` (Windows: DPAPI, macOS: Keychain, Linux: the desktop's secret service) in
 * `<userData>/secrets.json` (25 September 2026, docs/features/desktop.md, "Keys in safeStorage"). Until then the client kept
 * them unencrypted in the origin's localStorage; it moves them over itself (identity.ts).
 *
 * Synchronous IPC on purpose: the client reads its key synchronously in many places, and a handful of small values at start
 * costs nothing. Without real encryption (Linux without a keyring falls back to "basic_text") `available` is false and the
 * client stays with localStorage: a plain file would be no better, and moving the key there would hide that.
 */
type Stored = Record<string, string>;

export function handleSecrets(userData: string, isClientFrame: (event: IpcMainEvent) => boolean): void {
  const file = join(userData, "secrets.json");
  const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend?.() : undefined;
  const available = safeStorage.isEncryptionAvailable() && backend !== "basic_text";
  const allowed = new Set<string>(SECRET_KEYS);

  const read = (): Stored => {
    try { const v = JSON.parse(readFileSync(file, "utf8")) as unknown; return typeof v === "object" && v !== null ? v as Stored : {}; } catch { return {}; }
  };
  const write = (all: Stored) => {
    // Write the new file next to the old one, then swap: a crash mid-write never leaves half a key.
    writeFileSync(`${file}.tmp`, JSON.stringify(all), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };

  // Every handler answers exactly once: Electron sends `returnValue` at its first assignment (a later one is lost), and a
  // sendSync without an answer would hang the page. So each computes its answer first.
  const get = (event: IpcMainEvent, key: unknown): string | null => {
    if (!available || !isClientFrame(event) || typeof key !== "string" || !allowed.has(key)) return null;
    const enc = read()[key];
    if (typeof enc !== "string") return null;
    try { return safeStorage.decryptString(Buffer.from(enc, "base64")); } catch { return null; } // another user's or machine's file
  };
  const set = (event: IpcMainEvent, key: unknown, value: unknown): boolean => {
    if (!available || !isClientFrame(event) || typeof key !== "string" || !allowed.has(key)) return false;
    if (value !== null && (typeof value !== "string" || value.length > 1_000_000)) return false;
    try {
      const all = read();
      if (value === null) delete all[key];
      else all[key] = safeStorage.encryptString(value).toString("base64");
      write(all);
      return true;
    } catch (err) { console.warn(`secrets: ${key} not written:`, err instanceof Error ? err.message : err); return false; } // the client keeps its copy
  };
  ipcMain.on(IPC.secretsAvailable, (event) => { event.returnValue = available && isClientFrame(event); });
  ipcMain.on(IPC.secretsGet, (event, key: unknown) => { event.returnValue = get(event, key); });
  ipcMain.on(IPC.secretsSet, (event, key: unknown, value: unknown) => { event.returnValue = set(event, key, value); });
}

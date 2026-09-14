import { DirectoryAccount } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config";
import type { Db } from "./db";
import { users } from "./db/schema";

/**
 * Anbindung an den Verzeichnisdienst (M6): Schluessel -> Handle beim Login nachschlagen und am Nutzer cachen.
 * Best effort mit kurzem Timeout; ist der Dienst nicht erreichbar, bleibt der letzte bekannte Stand.
 * Der Chat-Server haengt zur Laufzeit nie vom Dienst ab (PLAN 3.2).
 */
export async function refreshHandle(db: Db, config: Config, log: FastifyBaseLogger, userId: string, publicKey: string): Promise<string | null> {
  if (!config.DIRECTORY_URL) return null;
  try {
    const res = await fetch(`${config.DIRECTORY_URL}/api/keys/${publicKey}`, { signal: AbortSignal.timeout(2500) });
    let handle: string | null = null;
    if (res.status === 200) handle = DirectoryAccount.parse(await res.json()).handle;
    else if (res.status !== 404) { log.warn({ status: res.status }, "Verzeichnisdienst antwortet unerwartet"); return null; }
    await db.update(users).set({ handle, handleCheckedAt: new Date() }).where(eq(users.id, userId));
    return handle;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "Verzeichnisdienst nicht erreichbar; Handle bleibt wie zuletzt bekannt");
    return null;
  }
}

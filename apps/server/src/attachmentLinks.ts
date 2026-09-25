import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { serverSettings } from "./db/schema";
import { SETTINGS_ID } from "./state";

/**
 * Signed attachment links (25 September 2026, user's decision; docs/features/channel-permissions.md, "Attachments"). A link
 * carries an expiry and an HMAC over the attachment's id and that expiry, so a link that leaves the server dies within days
 * and whoever lost a channel gets no fresh ones. The expiry is rounded to the day, so a link stays the same for a whole day
 * and the browser's cache keeps working: a link is valid for at least LINK_DAYS and at most one day more.
 * The key is the server's own (`server_settings.link_secret`, generated at the first start, kept).
 */
export const LINK_DAYS = 7;
const DAY_MS = 86_400_000;

let secret: Buffer | null = null;

/** For tests, and for loadLinkSecret. */
export function setLinkSecret(s: Buffer) { secret = s; }

/** Load the key, or create it once. Call at startup before any route answers. */
export async function loadLinkSecret(db: Db): Promise<void> {
  const [s] = await db.select({ key: serverSettings.linkSecret }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
  let hex = s?.key ?? null;
  if (!hex) {
    hex = randomBytes(32).toString("hex");
    await db.update(serverSettings).set({ linkSecret: hex }).where(eq(serverSettings.id, SETTINGS_ID));
  }
  secret = Buffer.from(hex, "hex");
}

function mac(id: string, expires: number): string {
  if (!secret) throw new Error("link secret not loaded");
  return createHmac("sha256", secret).update(`${id}.${expires}`).digest("base64url").slice(0, 32);
}

/** The query string for an attachment: `e` = expiry in seconds (end of the day LINK_DAYS from now), `s` = signature. */
export function signAttachment(id: string, now = Date.now()): string {
  const expires = Math.floor((Math.floor(now / DAY_MS) + LINK_DAYS + 1) * DAY_MS / 1000);
  return `e=${expires}&s=${mac(id, expires)}`;
}

/** Whether a request's `e` and `s` are a valid, unexpired signature for this attachment. */
export function verifyAttachment(id: string, e: unknown, s: unknown, now = Date.now()): boolean {
  if (typeof e !== "string" || typeof s !== "string" || !/^\d{1,12}$/.test(e)) return false;
  const expires = Number(e);
  if (expires * 1000 <= now) return false;
  const want = Buffer.from(mac(id, expires));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

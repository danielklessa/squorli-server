import { z } from "zod";
// COPY NOTE: also exists byte-identically in the squorli-directory repo (packages/protocol/src); the source is squorli-server, copy it over after any change.

/** Basic building blocks shared by the chat protocol and the directory service. */
export const Uuid = z.string().uuid();
export const Iso = z.string().datetime();
/** Public key as 64 hex characters (32 bytes). */
export const PublicKey = z.string().regex(/^[0-9a-f]{64}$/, "64 hex chars");
/** Signature as 128 hex characters (64 bytes). */
export const Signature = z.string().regex(/^[0-9a-f]{128}$/, "128 hex chars");

/**
 * Why somebody reports something (26 September 2026): one list for a report on a chat server (reports.ts: a message or a member
 * to the server's moderators) and for one to the directory (directory.ts: a direct message to the directory's operator), so the
 * client's one dialog serves both. `REPORT_TEXT_MAX` is the reporter's free text.
 */
export const REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "illegal", "other"] as const;
export const ReportReason = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReason>;
export const REPORT_TEXT_MAX = 1000;

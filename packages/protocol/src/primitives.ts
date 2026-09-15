import { z } from "zod";
// COPY NOTE: also exists byte-identically in the squorli-directory repo (packages/protocol/src); the source is squorli-server, copy it over after any change.

/** Basic building blocks shared by the chat protocol and the directory service. */
export const Uuid = z.string().uuid();
export const Iso = z.string().datetime();
/** Public key as 64 hex characters (32 bytes). */
export const PublicKey = z.string().regex(/^[0-9a-f]{64}$/, "64 hex chars");
/** Signature as 128 hex characters (64 bytes). */
export const Signature = z.string().regex(/^[0-9a-f]{128}$/, "128 hex chars");

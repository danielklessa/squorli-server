import { z } from "zod";
// KOPIE-HINWEIS: liegt byte-identisch auch im Repo squorli-directory (packages/protocol/src); Quelle ist squorli-server, nach Aenderung kopieren.

/** Grundbausteine, die Chat-Protokoll und Verzeichnisdienst teilen. */
export const Uuid = z.string().uuid();
export const Iso = z.string().datetime();
/** Oeffentlicher Schluessel als 64 Hex-Zeichen (32 Byte). */
export const PublicKey = z.string().regex(/^[0-9a-f]{64}$/, "64 hex chars");
/** Signatur als 128 Hex-Zeichen (64 Byte). */
export const Signature = z.string().regex(/^[0-9a-f]{128}$/, "128 hex chars");

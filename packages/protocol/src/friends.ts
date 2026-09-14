import { z } from "zod";
import { DisplayName, Handle } from "./directory";
import { Iso, PublicKey, Signature, Uuid } from "./primitives";

// KOPIE-HINWEIS: liegt byte-identisch auch im Repo squorli-directory (packages/protocol/src); Quelle ist squorli-server, nach Aenderung kopieren.
/**
 * Freunde und Direktnachrichten (M7): beides lebt beim Verzeichnisdienst, weil nur er beiden Konten gemeinsam ist.
 * Der Chat-Client haelt eine zweite WebSocket-Verbindung zum Verzeichnis (GET /api/ws): das Verzeichnis schickt eine
 * Challenge, der Client antwortet mit einer Signatur seines Schluessels, danach ist der Socket die Identitaet.
 * Freundschaft = eine Zeile je Paar; sie gilt erst, wenn die eingeladene Seite angenommen hat (pending_in -> accepted).
 * Nachrichten sind Ende-zu-Ende verschluesselt (dm.ts); das Verzeichnis sieht und speichert nur Chiffretext und Metadaten.
 */

/** Version des Verzeichnis-Sockets; der Dienst lehnt aeltere Clients mit error `version` ab. */
export const DIRECTORY_WS_VERSION = 1;

/** Signatur beim Verbindungsaufbau: an den Host des Verzeichnisses gebunden wie alle anderen Signaturen. */
export function directoryWsAuthMessage(directoryHost: string, nonce: string): string {
  return `community-directory-ws\n${directoryHost}\n${nonce}`;
}

/** Aus meiner Sicht: ich habe angefragt (pending_out), ich wurde angefragt (pending_in), bestaetigt, von mir blockiert. */
export const FriendState = z.enum(["pending_out", "pending_in", "accepted", "blocked"]);
export type FriendState = z.infer<typeof FriendState>;
/** Ein Freund oder eine offene Anfrage. Den globalen Anzeigenamen gibt es nur fuer bestaetigte Freunde, sonst nur das Handle. */
export const Friend = z.object({
  handle: Handle,
  publicKey: PublicKey,
  displayName: DisplayName.nullable(),
  state: FriendState,
  /** Zeitpunkt der Anfrage bzw. der Bestaetigung. */
  since: Iso,
  /** Praesenz ueber das Verzeichnis (Nutzerentscheidung 14.09.2026): mindestens ein Socket verbunden; nur fuer bestaetigte Freunde, sonst false. */
  online: z.boolean().default(false),
});
export type Friend = z.infer<typeof Friend>;

/** Oeffentliche Handle-Suche (GET /api/handles?q=<prefix>): nur Handle und Schluessel, hoechstens 10 Treffer. */
export const FriendSearchResult = z.object({ handle: Handle, publicKey: PublicKey });
export const FriendSearchResponse = z.array(FriendSearchResult);
export type FriendSearchResult = z.infer<typeof FriendSearchResult>;

/** Chiffretext (base64) bis 16 KB; das Verzeichnis prueft nur die Laenge. */
export const DM_MAX_CIPHERTEXT_CHARS = 22_000;
const DmIv = z.string().regex(/^[0-9a-f]{24}$/, "24 hex chars");
const DmCiphertext = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(DM_MAX_CIPHERTEXT_CHARS);
/** Eine gespeicherte Nachricht: `seq` vergibt das Verzeichnis (Reihenfolge und Cursor), alles andere kommt vom Absender. */
export const DmMessage = z.object({
  id: Uuid,
  seq: z.number().int().nonnegative(),
  from: PublicKey,
  to: PublicKey,
  iv: DmIv,
  ciphertext: DmCiphertext,
  sentAt: Iso,
});
export type DmMessage = z.infer<typeof DmMessage>;
/** Gespraech mit einem Freund aus Sicht des Kontos: letzte Nachricht und Ungelesenes (Lesecursor liegt beim Verzeichnis, gilt fuer alle Geraete). */
export const DmConversation = z.object({ peer: PublicKey, lastSeq: z.number().int(), lastAt: Iso, unread: z.number().int().nonnegative() });
export type DmConversation = z.infer<typeof DmConversation>;

// ---- Client -> Verzeichnis
export const DirectoryClientAuth = z.object({ type: z.literal("auth"), publicKey: PublicKey, signature: Signature, version: z.number().int() });
export const DirectoryClientPing = z.object({ type: z.literal("ping"), t: z.number() });
/** Anfrage an einen Schluessel (der Client hat Handle -> Schluessel vorher aufgeloest). Liegt schon eine Anfrage der Gegenseite vor, wird sie damit angenommen. */
export const FriendRequest = z.object({ type: z.literal("friends.request"), publicKey: PublicKey });
export const FriendAction = z.object({ type: z.enum(["friends.accept", "friends.decline", "friends.remove", "friends.block", "friends.unblock"]), publicKey: PublicKey });
export const DmSend = z.object({ type: z.literal("dm.send"), to: PublicKey, id: Uuid, iv: DmIv, ciphertext: DmCiphertext, sentAt: Iso });
export const DmHistoryRequest = z.object({ type: z.literal("dm.history"), peer: PublicKey, before: z.number().int().optional(), limit: z.number().int().min(1).max(100).optional() });
export const DmReadRequest = z.object({ type: z.literal("dm.read"), peer: PublicKey, seq: z.number().int().nonnegative() });
/**
 * Nachricht loeschen (Nutzerentscheidung 14.09.2026): der Absender loescht innerhalb von DM_DELETE_BOTH_MS fuer beide Seiten,
 * danach (und der Empfaenger immer) nur fuer sich; die Gegenseite behaelt dann ihre Kopie.
 */
export const DM_DELETE_BOTH_MS = 5 * 60_000;
export const DmDeleteRequest = z.object({ type: z.literal("dm.delete"), peer: PublicKey, id: Uuid });
/** Ganzes Gespraech fuer mich loeschen (die Gegenseite behaelt ihre Kopie). */
export const DmClearRequest = z.object({ type: z.literal("dm.clear"), peer: PublicKey });
export const DirectoryClientEvent = z.discriminatedUnion("type", [DirectoryClientAuth, DirectoryClientPing, FriendRequest, DmSend, DmHistoryRequest, DmReadRequest, DmDeleteRequest, DmClearRequest])
  .or(FriendAction);
export type DirectoryClientEvent = z.infer<typeof DirectoryClientEvent>;

// ---- Verzeichnis -> Client
export const DirectoryChallengeEvent = z.object({ type: z.literal("challenge"), nonce: z.string().regex(/^[0-9a-f]{64}$/), host: z.string() });
export const DirectoryWelcomeEvent = z.object({ type: z.literal("welcome"), friends: z.array(Friend), conversations: z.array(DmConversation), serverTime: Iso });
export const DirectoryPongEvent = z.object({ type: z.literal("pong") });
/** Freund bzw. Anfrage geaendert; `friend: null` = Eintrag weg (entfernt, abgelehnt, zurueckgezogen, von der Gegenseite blockiert). */
export const FriendUpdateEvent = z.object({ type: z.literal("friends.update"), publicKey: PublicKey, friend: Friend.nullable() });
/** Live-Zustellung; geht auch an die anderen Geraete des Absenders. */
export const DmMessageEvent = z.object({ type: z.literal("dm.message"), message: DmMessage });
export const DmHistoryEvent = z.object({ type: z.literal("dm.history"), peer: PublicKey, messages: z.array(DmMessage), more: z.boolean() });
/** Lesecursor auf einem anderen Geraet bewegt. */
export const DmReadEvent = z.object({ type: z.literal("dm.read"), peer: PublicKey, seq: z.number().int() });
/** Nachricht weg: `both` = auch beim Peer geloescht (Absender innerhalb der Frist), sonst nur bei mir (geht an meine anderen Geraete). */
export const DmDeletedEvent = z.object({ type: z.literal("dm.deleted"), peer: PublicKey, id: Uuid, both: z.boolean() });
export const DmClearedEvent = z.object({ type: z.literal("dm.cleared"), peer: PublicKey });
/** Ein bestaetigter Freund ist online gegangen oder weg. */
export const FriendPresenceEvent = z.object({ type: z.literal("friends.presence"), publicKey: PublicKey, online: z.boolean() });
export const DirectoryErrorCode = z.enum(["version", "unauthorized", "bad_message", "unknown_account", "self", "not_friends", "blocked", "declined_recently", "rate_limited", "too_large", "duplicate", "not_found"]);
export type DirectoryErrorCode = z.infer<typeof DirectoryErrorCode>;
/** `ref` = id der Nachricht (dm.send) bzw. Schluessel (friends.*), auf die sich der Fehler bezieht. */
export const DirectoryErrorEvent = z.object({ type: z.literal("error"), code: DirectoryErrorCode, message: z.string(), ref: z.string().nullable().default(null) });
export const DirectoryServerEvent = z.discriminatedUnion("type", [
  DirectoryChallengeEvent, DirectoryWelcomeEvent, DirectoryPongEvent, FriendUpdateEvent, FriendPresenceEvent, DmMessageEvent, DmHistoryEvent, DmReadEvent, DmDeletedEvent, DmClearedEvent, DirectoryErrorEvent,
]);
export type DirectoryServerEvent = z.infer<typeof DirectoryServerEvent>;

// ---- Kontoseite (ohne Socket): dieselben Freundesaktionen als signierte Kontoaktion "friends" (POST /api/friends), Antwort = die
// Liste danach. Nutzlast der Signatur "<op>\n<publicKey|leer>", damit weder Aktion noch Ziel ausgetauscht werden koennen.
export const FriendOp = z.enum(["list", "request", "accept", "decline", "remove", "block", "unblock"]);
export type FriendOp = z.infer<typeof FriendOp>;
export function directoryFriendsPayload(op: FriendOp, publicKey: string | null): string {
  return `${op}\n${publicKey ?? ""}`;
}
export const FriendsActionRequest = z.object({ publicKey: PublicKey, challengeId: Uuid, signature: Signature, op: FriendOp, target: PublicKey.nullable() });
export const FriendsListResponse = z.array(Friend);

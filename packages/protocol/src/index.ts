/**
 * Gemeinsames Protokoll zwischen Client und App-Server.
 * Eine Quelle der Wahrheit: Schemata hier, Typen werden abgeleitet.
 *
 * Medien laufen NICHT hier durch, sondern direkt zwischen Client und LiveKit.
 */
import { z } from "zod";

export * from "./permissions";
export * from "./directory";
export * from "./backup";
export * from "./useragent";
export { Iso, PublicKey, Signature, Uuid } from "./primitives";
import { Iso, PublicKey, Signature, Uuid } from "./primitives";

/** Bei inkompatiblen Aenderungen erhoehen. Server lehnt aeltere Clients ab. */
export const PROTOCOL_VERSION = 4; // v4: voice.moved/voice.stop, Member.streamBlocked, MODERATE_VOICE

// ---------- REST: Auth (Challenge-Response mit Ed25519) ----------

/** Einladungscode: URL-sicher, wie er in /invite/<code> steht. */
export const InviteCode = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/);

// ChallengeRequest/ChallengeResponse liegen in directory.ts (Chat-Server und Verzeichnisdienst teilen den Challenge-Vertrag).

export const VerifyRequest = z.object({
  challengeId: Uuid,
  publicKey: PublicKey,
  signature: Signature,
  /** Noetig, wenn der Server nicht offen ist und der Schluessel noch kein Mitglied ist. */
  invite: InviteCode.optional(),
});
export const VerifyResponse = z.object({
  sessionToken: z.string(),
  userId: Uuid,
  expiresAt: Iso,
});
/** Fehlercodes von /api/auth/verify, die der Client gesondert behandelt. */
export const VerifyErrorCode = z.enum(["challenge_invalid", "signature_invalid", "invite_required", "invite_invalid", "banned"]);

/** Was der Client signiert. Domain-Bindung verhindert Wiederverwendung auf anderen Servern. */
export function challengeMessage(domain: string, nonce: string): string {
  return `community-chat-login\n${domain}\n${nonce}`;
}

// ---------- Profil ----------

/** Anzeigename pro Server (siehe PLAN 3.2). Leer = Kurzform des Schluessels. */
export const DisplayName = z.string().trim().min(1).max(32);
export const Me = z.object({
  userId: Uuid,
  publicKey: PublicKey,
  displayName: DisplayName.nullable(),
  /** Verifiziertes Handle aus dem Verzeichnisdienst (M6), null ohne Dienst oder ohne Registrierung. */
  handle: z.string().nullable(),
});
export const UpdateMeRequest = z.object({ displayName: DisplayName.nullable() });

/** Sitzung (Geraet) des angemeldeten Nutzers auf diesem Server (M6c, Geraeteverwaltung). Das Token bleibt geheim, `id` ist die Kennung. */
export const SessionInfo = z.object({
  id: Uuid,
  /** Aus dem User-Agent beim Login, z. B. "Chrome auf Windows"; null, wenn unbekannt. */
  label: z.string().nullable(),
  createdAt: Iso,
  lastUsedAt: Iso.nullable(),
  expiresAt: Iso,
  /** Die Sitzung, mit der diese Anfrage gestellt wurde. */
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

/** Anzeigename mit Fallback auf die ersten Zeichen des Schluessels. */
export function displayNameOf(u: { displayName: string | null; publicKey: string; handle?: string | null }): string {
  return u.displayName ?? (u.handle ? `@${u.handle}` : `anon-${u.publicKey.slice(0, 6)}`);
}

// ---------- Server-Struktur ----------

export const ServerSettings = z.object({
  name: z.string().min(1).max(64),
  /** true = jeder mit Schluessel darf beitreten; false = Einladung noetig. */
  openJoin: z.boolean(),
  /** Erster Eigentuemer (beim ersten Login festgelegt); weitere Eigentuemer stehen an den Mitgliedern (isOwner). */
  ownerId: Uuid.nullable(),
  /** Server-Icon aus der Verwaltung (mit Versions-Parameter fuer den Cache), null = keins. Dient dem Client auch als Favicon. */
  iconUrl: z.string().nullable(),
});
export const UpdateSettingsRequest = ServerSettings.pick({ name: true, openJoin: true }).partial();

export const Category = z.object({ id: Uuid, name: z.string().min(1).max(64), position: z.number().int() });
export const ChannelKind = z.enum(["text", "voice"]);
/**
 * Sprachqualitaet je Sprachkanal (M3). Codec ist im Browser immer Opus; einstellbar sind Bitrate (kbit/s) und Stereo.
 * Mono mit DTX/RED = Sprache; Stereo ohne Browser-Klangbearbeitung = Musik/Instrumente.
 */
export const AUDIO_BITRATES = [24, 32, 48, 64, 96, 128, 192, 256] as const;
export const DEFAULT_AUDIO_BITRATE = 64;
const AudioBitrate = z.number().int().min(8).max(320);

export const Channel = z.object({
  id: Uuid,
  kind: ChannelKind,
  name: z.string().min(1).max(64),
  topic: z.string().max(256).nullable(),
  categoryId: Uuid.nullable(),
  position: z.number().int(),
  /** Opus-Bitrate in kbit/s (nur Sprachkanaele relevant). */
  audioBitrate: AudioBitrate,
  /** Stereo senden (Musik); schaltet Echo-/Rauschunterdrueckung beim Sender ab. */
  audioStereo: z.boolean(),
});
export const CreateCategoryRequest = z.object({ name: Category.shape.name });
export const UpdateCategoryRequest = z.object({ name: Category.shape.name.optional(), position: z.number().int().optional() });
export const CreateChannelRequest = z.object({
  kind: ChannelKind,
  name: Channel.shape.name,
  topic: Channel.shape.topic.optional(),
  categoryId: Uuid.nullable().optional(),
  audioBitrate: AudioBitrate.optional(),
  audioStereo: z.boolean().optional(),
});
export const UpdateChannelRequest = z.object({
  name: Channel.shape.name.optional(),
  topic: Channel.shape.topic.optional(),
  categoryId: Uuid.nullable().optional(),
  position: z.number().int().optional(),
  audioBitrate: AudioBitrate.optional(),
  audioStereo: z.boolean().optional(),
});

export const Role = z.object({
  id: Uuid,
  name: z.string().min(1).max(32),
  color: z.string().regex(/^#[0-9a-f]{6}$/).nullable(),
  permissions: z.number().int().nonnegative(),
  /** Hoeher = maechtiger. Wer Rollen/Mitglieder verwaltet, darf nur unterhalb seiner hoechsten Position wirken. */
  position: z.number().int(),
  /** Die @everyone-Rolle: jedes Mitglied hat sie, sie ist nicht loeschbar. */
  isDefault: z.boolean(),
});
export const CreateRoleRequest = z.object({ name: Role.shape.name, color: Role.shape.color.optional(), permissions: Role.shape.permissions.optional() });
export const UpdateRoleRequest = z.object({
  name: Role.shape.name.optional(),
  color: Role.shape.color.optional(),
  permissions: Role.shape.permissions.optional(),
  position: z.number().int().optional(),
});

export const Member = z.object({
  userId: Uuid,
  displayName: z.string(),
  publicKey: PublicKey,
  roleIds: z.array(Uuid),
  joinedAt: Iso,
  online: z.boolean(),
  /** Moderator hat Kamera/Bildschirm fuer dieses Mitglied gesperrt (ueberstimmt STREAM_VIDEO aus Rollen). */
  streamBlocked: z.boolean(),
  /** Verifiziertes Handle aus dem Verzeichnisdienst (M6), sonst null. */
  handle: z.string().nullable(),
  /** Eigentuemer (mehrere moeglich): immer alle Rechte, steht ganz oben, kann nicht gekickt oder gebannt werden. */
  isOwner: z.boolean(),
});
export const SetMemberRolesRequest = z.object({ roleIds: z.array(Uuid) });
/** Eigentuemerstatus setzen (nur durch Eigentuemer; der erste Eigentuemer laesst sich nicht entziehen). */
export const SetOwnerRequest = z.object({ owner: z.boolean() });
/** Mitglied in einen anderen Sprachkanal verschieben; null = aus dem Sprachkanal entfernen. */
export const MoveMemberRequest = z.object({ channelId: Uuid.nullable() });
/** Kamera und/oder Bildschirm eines Mitglieds beenden. */
export const StopStreamRequest = z.object({ camera: z.boolean().default(true), screen: z.boolean().default(true) });
export const SetStreamBlockedRequest = z.object({ blocked: z.boolean() });
export const BanRequest = z.object({ userId: Uuid, reason: z.string().max(256).nullable().optional() });
export const Ban = z.object({ userId: Uuid, displayName: z.string(), reason: z.string().nullable(), bannedBy: Uuid.nullable(), createdAt: Iso });

export const Invite = z.object({
  code: InviteCode,
  createdBy: Uuid.nullable(),
  createdAt: Iso,
  expiresAt: Iso.nullable(),
  maxUses: z.number().int().positive().nullable(),
  uses: z.number().int().nonnegative(),
});
export const CreateInviteRequest = z.object({
  expiresInHours: z.number().int().positive().max(24 * 365).nullable().optional(),
  maxUses: z.number().int().positive().max(10_000).nullable().optional(),
});
/** Oeffentliche Vorschau einer Einladung (ohne Anmeldung abrufbar). */
export const InvitePreview = z.object({ serverName: z.string(), memberCount: z.number().int(), valid: z.boolean() });

// ---------- Nachrichten ----------

export const MessageContent = z.string().trim().min(1).max(4000);
export const Attachment = z.object({
  id: Uuid,
  name: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  /** Relativer Pfad zum Herunterladen. */
  url: z.string(),
});
export const Message = z.object({
  id: Uuid,
  /** Monoton steigend pro Server, fuer Reihenfolge und Cursor. */
  seq: z.number().int(),
  channelId: Uuid,
  authorId: Uuid,
  content: z.string(),
  attachments: z.array(Attachment),
  createdAt: Iso,
  editedAt: Iso.nullable(),
});
export const CreateMessageRequest = z.object({
  content: z.string().trim().max(4000),
  attachmentIds: z.array(Uuid).max(10).optional(),
}).refine((m) => m.content.length > 0 || (m.attachmentIds?.length ?? 0) > 0, "content or attachment required");
export const UpdateMessageRequest = z.object({ content: MessageContent });
export const MessagePage = z.object({ messages: z.array(Message), hasMore: z.boolean() });

/** Kompletter Zustand, den ein Client nach dem Handshake braucht. */
export const ServerState = z.object({
  settings: ServerSettings,
  categories: z.array(Category),
  channels: z.array(Channel),
  roles: z.array(Role),
  members: z.array(Member),
  /** Effektive Rechte des angemeldeten Nutzers. */
  myPermissions: z.number().int(),
});

// ---------- REST: LiveKit-Beitritt ----------

/** Der Client darf nur Raeume anfragen, die als Sprachkanal existieren; der Server prueft Kanal und Recht. */
export const RtcTokenRequest = z.object({ channelId: Uuid });
export const RtcTokenResponse = z.object({
  /** Basis-URL fuer livekit-client (`Room.connect`), ohne Pfad. Das SDK haengt selbst /rtc an. */
  url: z.string().url(),
  token: z.string(),
});

// ---------- WebSocket: Ereignisse ----------

export const VoiceMember = z.object({ userId: Uuid, displayName: z.string() });

export const ClientHello = z.object({ type: z.literal("hello"), protocolVersion: z.number().int(), sessionToken: z.string() });
export const ClientPing = z.object({ type: z.literal("ping"), t: z.number() });
/** Kanalzustand ist Absicht, nicht Medienstatus: "ich moechte als Mitglied gelistet sein". */
export const ClientVoiceJoin = z.object({ type: z.literal("voice.join"), channelId: Uuid });
export const ClientVoiceLeave = z.object({ type: z.literal("voice.leave") });
export const ClientTyping = z.object({ type: z.literal("typing"), channelId: Uuid });

export const ClientEvent = z.discriminatedUnion("type", [ClientHello, ClientPing, ClientVoiceJoin, ClientVoiceLeave, ClientTyping]);

export const ServerWelcome = z.object({
  type: z.literal("welcome"),
  userId: Uuid,
  serverTime: Iso,
  protocolVersion: z.number().int(),
  state: ServerState,
});
export const ServerPong = z.object({ type: z.literal("pong"), t: z.number() });
/** Vollstaendiger Mitgliederstand eines Sprachkanals. Kein Delta: einfach und nach Reconnect korrekt. */
export const ServerVoiceState = z.object({ type: z.literal("voice.state"), channelId: Uuid, members: z.array(VoiceMember) });
/** Strukturaenderungen kommen als kompletter Stand des jeweiligen Teils. Klein genug, und nie inkonsistent. */
export const ServerStructure = z.object({
  type: z.literal("structure"),
  settings: ServerSettings.optional(),
  categories: z.array(Category).optional(),
  channels: z.array(Channel).optional(),
  roles: z.array(Role).optional(),
  members: z.array(Member).optional(),
});
/** Eigene Rechte haben sich geaendert (Rolle zugewiesen/entzogen, Rolle bearbeitet). */
export const ServerMe = z.object({ type: z.literal("me"), myPermissions: z.number().int() });
export const ServerMessageCreate = z.object({ type: z.literal("message.create"), message: Message });
export const ServerMessageUpdate = z.object({ type: z.literal("message.update"), message: Message });
export const ServerMessageDelete = z.object({ type: z.literal("message.delete"), channelId: Uuid, id: Uuid });
export const ServerTyping = z.object({ type: z.literal("typing"), channelId: Uuid, userId: Uuid });
/** Ein Moderator verschiebt dich in einen anderen Sprachkanal (null = aus dem Kanal); der Client tritt dort bei bzw. verlaesst. */
export const ServerVoiceMoved = z.object({ type: z.literal("voice.moved"), channelId: Uuid.nullable(), by: z.string() });
/** Ein Moderator beendet deine Kamera und/oder Bildschirmfreigabe (LiveKit hat die Spuren bereits stummgeschaltet). */
export const ServerVoiceStop = z.object({ type: z.literal("voice.stop"), camera: z.boolean(), screen: z.boolean(), by: z.string() });
/** Der Server hat dich entfernt (Kick/Ban); danach schliesst er die Verbindung. */
export const ServerRemoved = z.object({ type: z.literal("removed"), reason: z.enum(["kicked", "banned"]), message: z.string().nullable() });
export const ServerError = z.object({
  type: z.literal("error"),
  code: z.enum(["protocol_version", "unauthorized", "bad_message", "unknown_channel", "forbidden"]),
  message: z.string(),
});

export const ServerEvent = z.discriminatedUnion("type", [
  ServerWelcome, ServerPong, ServerVoiceState, ServerStructure, ServerMe,
  ServerMessageCreate, ServerMessageUpdate, ServerMessageDelete, ServerTyping, ServerVoiceMoved, ServerVoiceStop, ServerRemoved, ServerError,
]);

export type ClientEvent = z.infer<typeof ClientEvent>;
export type ServerEvent = z.infer<typeof ServerEvent>;
export type VerifyResponse = z.infer<typeof VerifyResponse>;
export type RtcTokenResponse = z.infer<typeof RtcTokenResponse>;
export type Me = z.infer<typeof Me>;
export type ServerSettings = z.infer<typeof ServerSettings>;
export type Category = z.infer<typeof Category>;
export type Channel = z.infer<typeof Channel>;
export type Role = z.infer<typeof Role>;
export type Member = z.infer<typeof Member>;
export type Ban = z.infer<typeof Ban>;
export type Invite = z.infer<typeof Invite>;
export type InvitePreview = z.infer<typeof InvitePreview>;
export type Message = z.infer<typeof Message>;
export type Attachment = z.infer<typeof Attachment>;
export type MessagePage = z.infer<typeof MessagePage>;
export type ServerState = z.infer<typeof ServerState>;
export type VoiceMember = z.infer<typeof VoiceMember>;

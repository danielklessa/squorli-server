/**
 * Shared protocol between client and app server.
 * One source of truth: schemas here, types are derived from them.
 *
 * Media does NOT flow through here, but directly between client and LiveKit.
 */
import { z } from "zod";

export * from "./permissions";
export * from "./directory";
export * from "./backup";
export * from "./useragent";
export * from "./friends";
export * from "./dm";
export * from "./mentions";
export { Iso, PublicKey, Signature, Uuid } from "./primitives";
import { Iso, PublicKey, Signature, Uuid } from "./primitives";
import { DisplayName } from "./directory";

/** Increment on incompatible changes. The server rejects older clients. */
export const PROTOCOL_VERSION = 4; // v4: voice.moved/voice.stop, Member.streamBlocked, MODERATE_VOICE

// ---------- REST: auth (challenge-response with Ed25519) ----------

/** Invite code: URL-safe, exactly as it appears in /invite/<code>. */
export const InviteCode = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/);

// ChallengeRequest/ChallengeResponse live in directory.ts (chat server and directory service share the challenge contract).

export const VerifyRequest = z.object({
  challengeId: Uuid,
  publicKey: PublicKey,
  signature: Signature,
  /** Required when the server is not open and the key is not a member yet. */
  invite: InviteCode.optional(),
});
export const VerifyResponse = z.object({
  sessionToken: z.string(),
  userId: Uuid,
  expiresAt: Iso,
});
/** Error codes from /api/auth/verify that the client handles specially. */
export const VerifyErrorCode = z.enum(["challenge_invalid", "signature_invalid", "invite_required", "invite_invalid", "banned"]);

/** What the client signs. The domain binding prevents reuse on other servers. */
export function challengeMessage(domain: string, nonce: string): string {
  return `community-chat-login\n${domain}\n${nonce}`;
}

// ---------- Profile ----------

// DisplayName lives in directory.ts (the directory uses the same schema).
export const Me = z.object({
  userId: Uuid,
  publicKey: PublicKey,
  displayName: DisplayName.nullable(),
  /** Verified handle from the directory service (M6), null without a service or without a registration. */
  handle: z.string().nullable(),
});
export const UpdateMeRequest = z.object({ displayName: DisplayName.nullable() });

/** Session (device) of the signed-in user on this server (M6c, device management). The token stays secret, `id` is the identifier. */
export const SessionInfo = z.object({
  id: Uuid,
  /** From the user agent at sign-in, e.g. "Chrome on Windows"; null if unknown. */
  label: z.string().nullable(),
  createdAt: Iso,
  lastUsedAt: Iso.nullable(),
  expiresAt: Iso,
  /** The session this request was made with. */
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

/** Display name with a fallback to the first characters of the key. */
export function displayNameOf(u: { displayName: string | null; publicKey: string; handle?: string | null }): string {
  return u.displayName ?? (u.handle ? `@${u.handle}` : `anon-${u.publicKey.slice(0, 6)}`);
}

// ---------- Server structure ----------

export const ServerSettings = z.object({
  name: z.string().min(1).max(64),
  /** true = anyone with a key may join; false = an invite is required. */
  openJoin: z.boolean(),
  /** First owner (determined at the first sign-in); further owners are marked on the members (isOwner). */
  ownerId: Uuid.nullable(),
  /** Server icon from the admin area (with a version parameter for caching), null = none. The client also uses it as the favicon. */
  iconUrl: z.string().nullable(),
  /**
   * true = sign-in only with an account at the directory (the key must have a handle there); owners are exempt.
   * No effect without DIRECTORY_URL (the server cannot check an account).
   */
  requireAccount: z.boolean(),
  /** true = REQUIRE_ACCOUNT is pinned by configuration; the admin area then cannot change requireAccount (409 locked_by_config). */
  requireAccountLocked: z.boolean(),
  /** M6d: list in the directory service's public server directory (with a description); no effect without DIRECTORY_URL. */
  listed: z.boolean(),
  description: z.string().trim().max(200).nullable(),
  /**
   * Web radio: turn a voice channel's radio off once nobody has been in the channel for RADIO_IDLE_STOP_MS (default on).
   * Optional = feature flag: a server from before it does not send the field and the admin area hides the switch.
   */
  radioAutoStop: z.boolean().optional(),
  /**
   * AFK channel: the voice channel absent members are moved to, null = none. Nobody can send, hear or share anything in it
   * (the LiveKit token carries no publish or subscribe grant) and it has no radio. Optional = feature flag: a server from
   * before the AFK detection does not send the field; clients then report no activity to it and hide the setting.
   */
  afkChannelId: Uuid.nullable().optional(),
  /** Minutes without activity after which a member in a voice channel is moved to the AFK channel (one of AFK_MOVE_MINUTES). */
  afkMoveMinutes: z.number().int().min(5).max(60).optional(),
});
export const UpdateSettingsRequest = ServerSettings.pick({ name: true, openJoin: true, requireAccount: true, listed: true, description: true, radioAutoStop: true, afkChannelId: true }).partial()
  .extend({ afkMoveMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).optional() });
/** What the admin area offers for ServerSettings.afkMoveMinutes; the AFK status itself always comes after AFK_AFTER_MS. */
export const AFK_MOVE_MINUTES = [5, 10, 15, 30, 60] as const;
export const DEFAULT_AFK_MOVE_MINUTES = 5;
/** How long a voice channel may stay empty before its radio is turned off (ServerSettings.radioAutoStop). */
export const RADIO_IDLE_STOP_MS = 2 * 60_000;

export const Category = z.object({ id: Uuid, name: z.string().min(1).max(64), position: z.number().int() });
export const ChannelKind = z.enum(["text", "voice"]);
/**
 * Voice quality per voice channel (M3). In the browser the codec is always Opus; bitrate (kbit/s) and stereo are configurable.
 * Mono with DTX/RED = speech; stereo without the browser's audio processing = music/instruments.
 */
export const AUDIO_BITRATES = [24, 32, 48, 64, 96, 128, 192, 256] as const;
export const DEFAULT_AUDIO_BITRATE = 64;
const AudioBitrate = z.number().int().min(8).max(320);

/**
 * Web radio: the server keeps a list of stations (admin area); a member with CONTROL_RADIO tunes a voice channel to one of
 * them. The audio never passes through the chat server or LiveKit: every client in the channel plays `streamUrl` itself,
 * at its own volume. A station's address is a direct audio stream or a playlist (.m3u, .m3u8, .pls) naming one; the
 * server resolves a playlist when the radio is started, because browsers cannot.
 */
export const RadioUrl = z.string().trim().max(2048).refine((u) => {
  try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; }
}, "http(s) url required");
/**
 * Twitch as a radio source: the address of a channel page (`https://www.twitch.tv/<login>`, also without www or with m.).
 * Twitch has no audio stream a browser may play from a foreign page, so such a source is shown with Twitch's official
 * player, as a tile in the voice stage (user's decision). Returns the channel's login in lower case, null = not a channel page.
 */
const TWITCH_RESERVED = new Set(["directory", "videos", "settings", "subscriptions", "inventory", "drops", "wallet", "downloads", "jobs", "p", "search", "turbo", "store", "friends", "payments", "prime", "privacy", "legal", "login", "signup", "popout", "embed", "team", "u", "moderator", "broadcast"]);
export function twitchChannelOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !/^(www\.|m\.)?twitch\.tv$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const login = parts[0]?.toLowerCase() ?? "";
    return parts.length === 1 && /^[a-z0-9_]{3,25}$/.test(login) && !TWITCH_RESERVED.has(login) ? login : null;
  } catch { return null; }
}

const MAX_PLAYBACK_POSITION = 360_000; // 100 hours
/**
 * YouTube as a radio source: the address of a video or live stream (watch?v=, youtu.be/, /live/, /shorts/, /embed/). Shown
 * with YouTube's official player like a Twitch source, and played in step for everyone: see RadioPlayback. `start` = the
 * address's start offset in seconds (`t=90`, `t=1m30s`, `start=90`), 0 without one. null = not a YouTube video.
 */
export function youtubeVideoOf(url: string): { videoId: string; start: number } | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
    const parts = u.pathname.split("/").filter(Boolean);
    let id: string | null = null;
    if (host === "youtu.be") id = parts.length === 1 ? parts[0]! : null;
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (parts.length === 1 && parts[0] === "watch") id = u.searchParams.get("v");
      else if (parts.length === 2 && ["live", "shorts", "embed", "v"].includes(parts[0]!)) id = parts[1]!;
    }
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const t = (u.searchParams.get("t") ?? u.searchParams.get("start") ?? "").toLowerCase();
    const clock = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    const start = clock && t !== "" ? Number(clock[1] ?? 0) * 3600 + Number(clock[2] ?? 0) * 60 + Number(clock[3] ?? 0) : 0;
    return { videoId: id, start: Number.isFinite(start) ? Math.min(start, MAX_PLAYBACK_POSITION) : 0 };
  } catch { return null; }
}

/**
 * Playing a video in step ("watch together"): where the video stands for everyone. `position` (seconds) was true at the
 * server's time `at` (ms since the epoch); while `playing`, it moves on at `rate` from there (radioPositionAt). The server
 * stamps `at`; members with CONTROL_RADIO set the rest through their player (PUT /api/channels/:id/radio/playback), and every
 * client keeps its own player at that place. Videos only: a live stream is not steered for everyone (user's decision),
 * every viewer's player is their own there; the state then simply goes unused.
 */
const PlaybackRate = z.number().min(0.25).max(2);
export const RadioPlayback = z.object({ playing: z.boolean(), position: z.number().min(0).max(MAX_PLAYBACK_POSITION), rate: PlaybackRate, at: z.number() });
export const SetRadioPlaybackRequest = z.object({ playing: z.boolean(), position: z.number().min(0).max(MAX_PLAYBACK_POSITION), rate: PlaybackRate.default(1) });
/** Where the video stands at the server's time `serverNow` (ms). */
export function radioPositionAt(p: { playing: boolean; position: number; rate: number; at: number }, serverNow: number): number {
  return p.playing ? Math.max(0, p.position + Math.max(0, serverNow - p.at) / 1000 * p.rate) : p.position;
}

export const RadioStation = z.object({ id: Uuid, name: z.string().trim().min(1).max(64), url: RadioUrl });
export const CreateRadioStationRequest = RadioStation.pick({ name: true, url: true });
export const UpdateRadioStationRequest = CreateRadioStationRequest.partial();
/**
 * What a voice channel is tuned to. `stationId` null = an address a member with CONTROL_RADIO typed in instead of choosing a
 * station; `name` is the station's current name (for a typed address: its host), `streamUrl` what clients play.
 */
export const ChannelRadio = z.object({
  stationId: Uuid.nullable(), name: z.string(), streamUrl: z.string(), startedBy: Uuid.nullable(),
  /** Set when the source is a Twitch channel: clients show Twitch's player instead of playing `streamUrl` as audio. */
  twitchChannel: z.string().nullable().default(null),
  /** Set when the source is a YouTube video or live stream: clients show YouTube's player, kept in step through `playback`. */
  youtubeVideo: z.string().nullable().default(null),
  /** Where the video stands for everyone (YouTube sources only). */
  playback: RadioPlayback.nullable().default(null),
});
/** PUT /api/channels/:id/radio: one of the server's stations, or any address (same rules as a station's). DELETE turns the radio off. */
export const SetChannelRadioRequest = z.union([z.object({ stationId: Uuid }), z.object({ url: RadioUrl })]);

export const Channel = z.object({
  id: Uuid,
  kind: ChannelKind,
  name: z.string().min(1).max(64),
  topic: z.string().max(256).nullable(),
  categoryId: Uuid.nullable(),
  position: z.number().int(),
  /** Opus bitrate in kbit/s (only relevant for voice channels). */
  audioBitrate: AudioBitrate,
  /** Send in stereo (music); turns off echo/noise suppression on the sender. */
  audioStereo: z.boolean(),
  /** Web radio playing in this voice channel, null = none. Default for servers from before the radio. */
  radio: ChannelRadio.nullable().default(null),
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
  /** Higher = more powerful. Whoever manages roles/members may only act below their own highest position. */
  position: z.number().int(),
  /** The @everyone role: every member has it and it cannot be deleted. */
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
  /** Absent: online, but no activity on any connection for AFK_AFTER_MS (reported by the clients, event `activity`). Default for servers from before it. */
  afk: z.boolean().default(false),
  /** A moderator has blocked camera/screen for this member (overrides STREAM_VIDEO from roles). */
  streamBlocked: z.boolean(),
  /** Verified handle from the directory service (M6), otherwise null. */
  handle: z.string().nullable(),
  /** Owner (several possible): always has every permission, sits at the very top, cannot be kicked or banned. */
  isOwner: z.boolean(),
});
export const SetMemberRolesRequest = z.object({ roleIds: z.array(Uuid) });
/** Set owner status (only by owners; the first owner cannot be revoked). */
export const SetOwnerRequest = z.object({ owner: z.boolean() });
/** Move a member to another voice channel; null = remove them from the voice channel. */
export const MoveMemberRequest = z.object({ channelId: Uuid.nullable() });
/** Stop a member's camera and/or screen. */
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
/** Public preview of an invite (retrievable without signing in). */
export const InvitePreview = z.object({ serverName: z.string(), memberCount: z.number().int(), valid: z.boolean() });

// ---------- Messages ----------

export const MessageContent = z.string().trim().min(1).max(4000);
export const Attachment = z.object({
  id: Uuid,
  name: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  /** Relative path for downloading. */
  url: z.string(),
});
export const Message = z.object({
  id: Uuid,
  /** Monotonically increasing per server, for ordering and cursors. */
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

/**
 * Read state of one text channel for the signed-in member, kept by the server so it holds on every device
 * (GET /api/read-state). `lastReadSeq` null = never opened: then everything since joining counts. `unread` and `mentions`
 * are computed by the server over messages of other people newer than the read state; `mentions` counts messages whose
 * text mentions the member (`<@userId>` outside code, `mentionedUserIds` in mentions.ts).
 */
export const ChannelReadState = z.object({
  channelId: Uuid,
  lastReadSeq: z.number().int().nullable(),
  /** Newest message in the channel, null = empty. */
  latestSeq: z.number().int().nullable(),
  unread: z.boolean(),
  mentions: z.number().int().min(0),
  /** The member has muted this channel: clients show no unread mark for it (mentions still count). Default for servers from before mutes. */
  muted: z.boolean().default(false),
});
export const ReadStateResponse = z.object({
  channels: z.array(ChannelReadState),
  /** The member has muted this whole server: no unread mark on the server rail (mentions still count). */
  serverMuted: z.boolean().default(false),
});
/** PUT /api/channels/:id/mute and PUT /api/me/mute. */
export const MuteRequest = z.object({ muted: z.boolean() });
export const MuteState = z.object({ serverMuted: z.boolean(), channelIds: z.array(Uuid) });
/** POST /api/channels/:id/read: everything up to `seq` has been seen. The server never moves a read state backwards. */
export const MarkReadRequest = z.object({ seq: z.number().int().min(0) });

/** The complete state a client needs after the handshake. */
export const ServerState = z.object({
  settings: ServerSettings,
  categories: z.array(Category),
  channels: z.array(Channel),
  roles: z.array(Role),
  members: z.array(Member),
  /** The server's web radio stations. Missing = a server from before the radio: clients then offer no radio at all. */
  radioStations: z.array(RadioStation).optional(),
  /** Effective permissions of the signed-in user. */
  myPermissions: z.number().int(),
});

// ---------- REST: joining LiveKit ----------

/** The client may only request rooms that exist as a voice channel; the server checks channel and permission. */
export const RtcTokenRequest = z.object({ channelId: Uuid });
export const RtcTokenResponse = z.object({
  /** Base URL for livekit-client (`Room.connect`), without a path. The SDK appends /rtc itself. */
  url: z.string().url(),
  token: z.string(),
});

// ---------- WebSocket: events ----------

export const VoiceMember = z.object({ userId: Uuid, displayName: z.string() });

export const ClientHello = z.object({ type: z.literal("hello"), protocolVersion: z.number().int(), sessionToken: z.string() });
export const ClientPing = z.object({ type: z.literal("ping"), t: z.number() });
/** Channel state is intent, not media state: "I want to be listed as a member". */
export const ClientVoiceJoin = z.object({ type: z.literal("voice.join"), channelId: Uuid });
export const ClientVoiceLeave = z.object({ type: z.literal("voice.leave") });
export const ClientTyping = z.object({ type: z.literal("typing"), channelId: Uuid });
/**
 * AFK detection: this connection's user has given no input (and has not spoken) for AFK_AFTER_MS (`idle: true`) or is back.
 * A connection counts as active until it says otherwise; a member is AFK once all their connections are idle. Sent only to
 * servers whose settings carry `afkMoveMinutes` (older servers would answer `bad_message`).
 */
export const ClientActivity = z.object({ type: z.literal("activity"), idle: z.boolean() });

export const ClientEvent = z.discriminatedUnion("type", [ClientHello, ClientPing, ClientVoiceJoin, ClientVoiceLeave, ClientTyping, ClientActivity]);

export const ServerWelcome = z.object({
  type: z.literal("welcome"),
  userId: Uuid,
  serverTime: Iso,
  protocolVersion: z.number().int(),
  state: ServerState,
});
export const ServerPong = z.object({ type: z.literal("pong"), t: z.number() });
/** Complete member state of a voice channel. Not a delta: simple, and correct after a reconnect. */
export const ServerVoiceState = z.object({ type: z.literal("voice.state"), channelId: Uuid, members: z.array(VoiceMember) });
/** Structure changes arrive as the complete state of the respective part. Small enough, and never inconsistent. */
export const ServerStructure = z.object({
  type: z.literal("structure"),
  settings: ServerSettings.optional(),
  categories: z.array(Category).optional(),
  channels: z.array(Channel).optional(),
  roles: z.array(Role).optional(),
  members: z.array(Member).optional(),
  radioStations: z.array(RadioStation).optional(),
});
/** Your own permissions changed (role assigned/revoked, role edited). */
export const ServerMe = z.object({ type: z.literal("me"), myPermissions: z.number().int() });
export const ServerMessageCreate = z.object({ type: z.literal("message.create"), message: Message });
export const ServerMessageUpdate = z.object({ type: z.literal("message.update"), message: Message });
export const ServerMessageDelete = z.object({ type: z.literal("message.delete"), channelId: Uuid, id: Uuid });
export const ServerTyping = z.object({ type: z.literal("typing"), channelId: Uuid, userId: Uuid });
/**
 * You have read a channel on one of your devices (sent only to your own connections, so the others drop their marks).
 * Added without a PROTOCOL_VERSION bump: clients drop events they cannot parse, and nothing depends on receiving it.
 */
export const ServerReadUpdate = z.object({ type: z.literal("read.update"), channelId: Uuid, lastReadSeq: z.number().int() });
/** Your mutes changed on one of your devices: the complete state (sent only to your own connections; no version bump, as above). */
export const ServerMuteUpdate = z.object({ type: z.literal("mute.update"), serverMuted: z.boolean(), channelIds: z.array(Uuid) });
/**
 * What the radio of a voice channel is playing right now (the station's ICY "StreamTitle", usually "Artist - Title"); null = unknown
 * or nothing beyond the station's name. Sent to everyone on a change and after the welcome for channels with a title. No
 * PROTOCOL_VERSION bump: older clients drop the event and simply keep showing the station's name.
 */
export const ServerRadioMeta = z.object({ type: z.literal("radio.meta"), channelId: Uuid, title: z.string().max(300).nullable() });
/**
 * A member with CONTROL_RADIO played, paused or moved the channel's video (RadioPlayback): everyone's player follows. The
 * channel list carries the same state for whoever connects later. No PROTOCOL_VERSION bump: older clients drop the event.
 */
export const ServerRadioPlayback = z.object({ type: z.literal("radio.playback"), channelId: Uuid, playback: RadioPlayback });
/**
 * A moderator moves you to another voice channel (null = out of the channel); the client joins there or leaves.
 * `reason: "afk"` = moved by the server into the AFK channel for inactivity (`by` is then the server's name; older clients
 * ignore the field and show the usual notice).
 */
export const ServerVoiceMoved = z.object({ type: z.literal("voice.moved"), channelId: Uuid.nullable(), by: z.string(), reason: z.enum(["afk"]).optional() });
/** A moderator stops your camera and/or screen share (LiveKit has already muted the tracks). */
export const ServerVoiceStop = z.object({ type: z.literal("voice.stop"), camera: z.boolean(), screen: z.boolean(), by: z.string() });
/** The server removed you (kick/ban); it closes the connection afterwards. */
export const ServerRemoved = z.object({ type: z.literal("removed"), reason: z.enum(["kicked", "banned"]), message: z.string().nullable() });
export const ServerError = z.object({
  type: z.literal("error"),
  code: z.enum(["protocol_version", "unauthorized", "bad_message", "unknown_channel", "forbidden"]),
  message: z.string(),
});

export const ServerEvent = z.discriminatedUnion("type", [
  ServerWelcome, ServerPong, ServerVoiceState, ServerStructure, ServerMe,
  ServerMessageCreate, ServerMessageUpdate, ServerMessageDelete, ServerTyping, ServerReadUpdate, ServerMuteUpdate, ServerRadioMeta, ServerRadioPlayback, ServerVoiceMoved, ServerVoiceStop, ServerRemoved, ServerError,
]);

export type ClientEvent = z.infer<typeof ClientEvent>;
export type ServerEvent = z.infer<typeof ServerEvent>;
export type VerifyResponse = z.infer<typeof VerifyResponse>;
export type RtcTokenResponse = z.infer<typeof RtcTokenResponse>;
export type Me = z.infer<typeof Me>;
export type ServerSettings = z.infer<typeof ServerSettings>;
export type Category = z.infer<typeof Category>;
export type Channel = z.infer<typeof Channel>;
export type RadioStation = z.infer<typeof RadioStation>;
export type ChannelRadio = z.infer<typeof ChannelRadio>;
export type RadioPlayback = z.infer<typeof RadioPlayback>;
export type Role = z.infer<typeof Role>;
export type Member = z.infer<typeof Member>;
export type Ban = z.infer<typeof Ban>;
export type Invite = z.infer<typeof Invite>;
export type InvitePreview = z.infer<typeof InvitePreview>;
export type Message = z.infer<typeof Message>;
export type Attachment = z.infer<typeof Attachment>;
export type MessagePage = z.infer<typeof MessagePage>;
export type ChannelReadState = z.infer<typeof ChannelReadState>;
export type ReadStateResponse = z.infer<typeof ReadStateResponse>;
export type MuteState = z.infer<typeof MuteState>;
export type ServerState = z.infer<typeof ServerState>;
export type VoiceMember = z.infer<typeof VoiceMember>;

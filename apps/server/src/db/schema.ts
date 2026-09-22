import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { LinkPreview } from "@squorli/protocol";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Identity = public Ed25519 key. No password. A user can exist without being a member (kicked/banned). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicKey: text("public_key").notNull().unique(),
  /** Profile per server (PLAN 3.2). null = show the short form of the key. */
  displayName: text("display_name"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
  /** Verified handle from the directory service (M6), looked up at sign-in and cached here. */
  handle: text("handle"),
  handleCheckedAt: ts("handle_checked_at"),
  /**
   * Avatar of the directory account (19 September 2026): address of the image at the directory incl. its cache version, cached here
   * together with handle and name; null = none. The image itself never passes through this server: the clients load it from the directory.
   */
  avatarUrl: text("avatar_url"),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  /** Public identifier for device management (M6c); the token stays secret. */
  id: uuid("id").notNull().defaultRandom().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  /** Derived from the user agent at sign-in, e.g. "Chrome on Windows". */
  label: text("label"),
  /** Updated on every request, throttled to once every 5 minutes. */
  lastUsedAt: ts("last_used_at"),
});

/** Exactly one row (id = "server"). One deployment = one server. */
export const serverSettings = pgTable("server_settings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  openJoin: boolean("open_join").notNull().default(false),
  /** Sign-in only with a directory account (handle); owners exempt. No effect without DIRECTORY_URL. */
  requireAccount: boolean("require_account").notNull().default(false),
  /** M6d: list in the server directory, with a description (both are sent to the directory at registration). */
  listed: boolean("listed").notNull().default(false),
  description: text("description"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  /** Server icon (admin): the file lives under DATA_DIR/server-icon, here the MIME type and timestamp (cache version). */
  iconMime: text("icon_mime"),
  iconUpdatedAt: ts("icon_updated_at"),
  /** The server's Ed25519 seed (hex) for registration at the directory (M6); generated on first start, unchanged afterwards. */
  directoryPrivateKey: text("directory_private_key"),
  /** Web radio: turn a channel's radio off once the channel has been empty for two minutes (admin area > server). */
  radioAutoStop: boolean("radio_auto_stop").notNull().default(true),
  /** AFK channel (admin area > server): absent members are moved here; no sending, no hearing, no radio in it. A deleted channel clears it. */
  afkChannelId: uuid("afk_channel_id").references((): AnyPgColumn => channels.id, { onDelete: "set null" }),
  /** Status API (docs/features/status-api.md): who may read GET /api/status; "off" (default), "key", "public". */
  statusApi: text("status_api", { enum: ["off", "key", "public"] }).notNull().default("off"),
  /** The key for mode "key" (random, base64url); null until the mode is first switched to "key". Regenerated in the admin area. */
  statusApiKey: text("status_api_key"),
});

/** Membership. Anyone missing here sees nothing and can do nothing. */
export const members = pgTable("members", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: ts("joined_at").notNull().defaultNow(),
  /** A moderator has blocked camera/screen (M3). */
  streamBlocked: boolean("stream_blocked").notNull().default(false),
  /** Owner (several possible). The first one is additionally recorded in server_settings.owner_id and cannot be revoked. */
  isOwner: boolean("is_owner").notNull().default(false),
  /** The member has muted this server: their clients show no unread mark for it on the server rail. */
  muted: boolean("muted").notNull().default(false),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

/** Web radio stations an admin offers (admin area > Radio). `url` = a direct audio stream or a playlist (.m3u, .m3u8, .pls). */
export const radioStations = pgTable("radio_stations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["text", "voice"] }).notNull(),
  name: text("name").notNull(),
  topic: text("topic"),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Voice quality (M3): Opus bitrate in kbit/s and stereo. */
  audioBitrate: integer("audio_bitrate").notNull().default(64),
  audioStereo: boolean("audio_stereo").notNull().default(false),
  /**
   * Web radio playing in this voice channel (`radio_stream_url` null = off; `radio_station_id` null = a typed address). Kept in the database so it survives a restart; clients only play
   * it while they are in the channel. `radio_stream_url` = what clients play (the station's address, or what its playlist named
   * when the radio was started).
   */
  radioStationId: uuid("radio_station_id").references(() => radioStations.id, { onDelete: "set null" }),
  radioStreamUrl: text("radio_stream_url"),
  /** Shown name when the radio plays an address a member typed in (no station): the address's host. */
  radioName: text("radio_name"),
  radioStartedBy: uuid("radio_started_by").references(() => users.id, { onDelete: "set null" }),
  /** Where a video source stands for everyone (protocol RadioPlayback; `at` = server time in ms). null for audio and Twitch. */
  radioPlayback: jsonb("radio_playback").$type<{ playing: boolean; position: number; rate: number; at: number }>(),
  /** A YouTube playlist played as a queue (radio/queue.ts): its videos and which one is on; `radio_stream_url` is that video. null for everything else. */
  radioQueue: jsonb("radio_queue").$type<{ listId: string; videoIds: string[]; index: number }>(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color"),
  permissions: integer("permissions").notNull().default(0),
  position: integer("position").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
});

export const memberRoles = pgTable(
  "member_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) }),
);

export const invites = pgTable("invites", {
  code: text("code").primaryKey(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at"),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  revokedAt: ts("revoked_at"),
});

export const bans = pgTable("bans", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  bannedBy: uuid("banned_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonically increasing across all channels: ordering and cursor for the history. */
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    /**
     * Link previews (previews/service.ts): what the server found for the message's links, in the order of the links, and
     * with `removed` the ones the author took away (kept so that an edit does not bring them back). null = none looked up.
     */
    previews: jsonb("previews").$type<(LinkPreview & { removed?: boolean })[]>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    editedAt: ts("edited_at"),
  },
  (t) => ({ byChannel: index("messages_channel_seq_idx").on(t.channelId, t.seq) }),
);

/**
 * How far a member has read a text channel (`messages.seq`), so unread marks and mention counters are the same on every
 * device. No row = never opened: then the messages since `members.joined_at` count (migration 0015 gave every existing
 * member a row per channel at the newest message, so an update does not mark everything).
 */
export const readStates = pgTable(
  "read_states",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.channelId] }) }),
);

/** Text channels a member has muted (no unread mark; mentions still count). A row = muted. */
export const channelMutes = pgTable(
  "channel_mutes",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.channelId] }) }),
);

/** The file lives under DATA_DIR/attachments/<id>; messageId is set when the message is sent. */
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
  uploaderId: uuid("uploader_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

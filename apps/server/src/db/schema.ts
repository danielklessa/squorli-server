import { bigserial, boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Identitaet = oeffentlicher Ed25519-Schluessel. Kein Passwort. Ein Nutzer kann existieren, ohne Mitglied zu sein (gekickt/gebannt). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicKey: text("public_key").notNull().unique(),
  /** Profil pro Server (PLAN 3.2). null = Kurzform des Schluessels anzeigen. */
  displayName: text("display_name"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
  /** Verifiziertes Handle aus dem Verzeichnisdienst (M6), beim Login nachgeschlagen und hier gecacht. */
  handle: text("handle"),
  handleCheckedAt: ts("handle_checked_at"),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  /** Oeffentliche Kennung fuer die Geraeteverwaltung (M6c); das Token bleibt geheim. */
  id: uuid("id").notNull().defaultRandom().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  /** Aus dem User-Agent beim Login abgeleitet, z. B. "Chrome auf Windows". */
  label: text("label"),
  /** Gedrosselt (alle 5 min) bei jeder Anfrage nachgefuehrt. */
  lastUsedAt: ts("last_used_at"),
});

/** Genau eine Zeile (id = "server"). Ein Deployment = ein Server. */
export const serverSettings = pgTable("server_settings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  openJoin: boolean("open_join").notNull().default(false),
  /** Anmeldung nur mit Verzeichniskonto (Handle); Eigentuemer ausgenommen. Ohne DIRECTORY_URL ohne Wirkung. */
  requireAccount: boolean("require_account").notNull().default(false),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  /** Server-Icon (Verwaltung): Datei liegt unter DATA_DIR/server-icon, hier MIME-Typ und Zeitpunkt (Cache-Version). */
  iconMime: text("icon_mime"),
  iconUpdatedAt: ts("icon_updated_at"),
  /** Ed25519-Seed (hex) des Servers fuer die Registrierung beim Verzeichnis (M6); beim ersten Start erzeugt, bleibt danach gleich. */
  directoryPrivateKey: text("directory_private_key"),
});

/** Mitgliedschaft. Wer hier fehlt, sieht nichts und kann nichts. */
export const members = pgTable("members", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: ts("joined_at").notNull().defaultNow(),
  /** Moderator hat Kamera/Bildschirm gesperrt (M3). */
  streamBlocked: boolean("stream_blocked").notNull().default(false),
  /** Eigentuemer (mehrere moeglich). Der erste steht zusaetzlich in server_settings.owner_id und ist unentziehbar. */
  isOwner: boolean("is_owner").notNull().default(false),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["text", "voice"] }).notNull(),
  name: text("name").notNull(),
  topic: text("topic"),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Sprachqualitaet (M3): Opus-Bitrate in kbit/s und Stereo. */
  audioBitrate: integer("audio_bitrate").notNull().default(64),
  audioStereo: boolean("audio_stereo").notNull().default(false),
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
    /** Monoton steigend ueber alle Kanaele: Reihenfolge und Cursor fuer den Verlauf. */
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    editedAt: ts("edited_at"),
  },
  (t) => ({ byChannel: index("messages_channel_seq_idx").on(t.channelId, t.seq) }),
);

/** Datei liegt unter DATA_DIR/attachments/<id>; messageId wird beim Senden der Nachricht gesetzt. */
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
  uploaderId: uuid("uploader_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

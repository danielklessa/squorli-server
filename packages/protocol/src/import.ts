import { z } from "zod";
import { Uuid } from "./primitives";

/**
 * Taking a server's structure over from elsewhere (22 September 2026, user's wish: "die Struktur eines Discord Servers
 * übernehmen"). The one source so far is a Discord server template (discord.new/<code>): the Discord server's owner
 * creates it in Discord's server settings, and Discord's template endpoint answers without any authentication, so no
 * bot and no token are needed. A template carries categories, channels and roles, never members or messages.
 *
 * `ServerState.importSources` names the sources the server offers; missing = a server from before the import, the
 * client then shows no import at all (feature flag instead of a protocol version bump, packages/protocol/AGENTS.md).
 */
export const ImportSource = z.enum(["discord-template"]);
export type ImportSource = z.infer<typeof ImportSource>;

const TEMPLATE_CODE = /^[A-Za-z0-9]{2,64}$/;
const TEMPLATE_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

/**
 * The code of a Discord server template as a user typed it: the link discord.new/<code>, discord.com/template/<code>
 * (also with www., http://, or a path after it) or the bare code. null = nothing of the sort.
 */
export function discordTemplateCodeOf(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (TEMPLATE_CODE.test(s)) return s;
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  let code: string | undefined;
  if (host === "discord.new") code = parts[0];
  else if (TEMPLATE_HOSTS.has(host) && parts[0] === "template") code = parts[1];
  return code !== undefined && TEMPLATE_CODE.test(code) ? code : null;
}

/**
 * A permission overwrite the template has for a channel or category (docs/features/channel-permissions.md, 23 September
 * 2026): `roleKey` is the template's role, "everyone" Discord's @everyone (which becomes an entry for the role "Gast"
 * here); the masks are already translated to Squorli's bits. Discord's overwrites for single accounts are dropped and
 * counted (`memberOverwrites`): their ids mean nothing here.
 */
export const ImportOverwrite = z.object({ roleKey: z.string(), allow: z.number().int().nonnegative(), deny: z.number().int().nonnegative() });
/** A category the template names. `existingId` = a category of that name already exists here; the channels then go into it and no category is created. */
export const ImportCategoryPlan = z.object({ key: z.string(), name: z.string().min(1).max(64), existingId: Uuid.nullable(), overwrites: z.array(ImportOverwrite).default([]), memberOverwrites: z.number().int().nonnegative().default(0) });
/** A channel the template names, in the order it should appear. `exists` = a channel of that name and kind already sits in that category, so it is not offered. */
export const ImportChannelPlan = z.object({
  key: z.string(),
  kind: z.enum(["text", "voice"]),
  name: z.string().min(1).max(64),
  topic: z.string().max(256).nullable(),
  /** Opus bitrate in kbit/s, rounded to the client's steps from Discord's bit/s (only for voice channels). */
  audioBitrate: z.number().int(),
  categoryKey: z.string().nullable(),
  /** The channel's permission overwrites, translated (ImportOverwrite); `private` = @everyone may not see it. */
  overwrites: z.array(ImportOverwrite).default([]),
  memberOverwrites: z.number().int().nonnegative().default(0),
  private: z.boolean().default(false),
  exists: z.boolean(),
});
/** A role the template names, most powerful first. `exists` = a role of that name already exists; `blocked` = the actor may not grant its permissions. */
export const ImportRolePlan = z.object({
  key: z.string(),
  name: z.string().min(1).max(32),
  color: z.string().regex(/^#[0-9a-f]{6}$/).nullable(),
  permissions: z.number().int().nonnegative(),
  exists: z.boolean(),
  blocked: z.enum(["cannot_grant"]).nullable(),
});
/** What the template has that Squorli cannot take over. */
export const ImportDropped = z.object({
  name: z.string(),
  kind: z.enum(["channel", "role"]),
  /** unsupported = a channel type without a counterpart (Discord's directory channels and the like); default_role = @everyone, the role "Gast" stays as it is (user's decision); role_not_imported = an overwrite for a role that is not taken over. */
  reason: z.enum(["unsupported", "default_role", "role_not_imported"]),
});

/** POST /api/import/discord/preview: what an import of the template would create here. The same plan is built again when it is applied. */
export const ImportPlan = z.object({
  source: z.object({ code: z.string(), name: z.string(), description: z.string().nullable() }),
  categories: z.array(ImportCategoryPlan),
  channels: z.array(ImportChannelPlan),
  roles: z.array(ImportRolePlan),
  /** The template's AFK channel, when it is one of the voice channels above; applied only when this server has no AFK channel yet and the actor may manage the server. */
  afkChannelKey: z.string().nullable(),
  dropped: z.array(ImportDropped),
});
export type ImportPlan = z.infer<typeof ImportPlan>;
export type ImportCategoryPlan = z.infer<typeof ImportCategoryPlan>;
export type ImportOverwrite = z.infer<typeof ImportOverwrite>;
export type ImportChannelPlan = z.infer<typeof ImportChannelPlan>;
export type ImportRolePlan = z.infer<typeof ImportRolePlan>;

/** The link or code as typed; the server answers 400 `bad_code` when `discordTemplateCodeOf` finds nothing in it. */
export const DiscordImportPreviewRequest = z.object({ code: z.string().trim().min(1).max(512) });
/** POST /api/import/discord: the keys of the plan's entries to create. A channel whose category is neither chosen nor existing is created without a category. */
export const DiscordImportRequest = z.object({
  code: z.string().trim().min(1).max(512),
  categories: z.array(z.string()).max(500),
  channels: z.array(z.string()).max(500),
  roles: z.array(z.string()).max(250),
  afkChannel: z.boolean().default(false),
});
export const DiscordImportResult = z.object({
  categories: z.number().int().nonnegative(),
  channels: z.number().int().nonnegative(),
  roles: z.number().int().nonnegative(),
  afkChannelSet: z.boolean(),
});
export type DiscordImportRequest = z.infer<typeof DiscordImportRequest>;
export type DiscordImportResult = z.infer<typeof DiscordImportResult>;

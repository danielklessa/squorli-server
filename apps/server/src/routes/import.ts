import { DiscordImportPreviewRequest, DiscordImportRequest, Permission, discordTemplateCodeOf, type DiscordImportResult, type ImportPlan } from "@squorli/protocol";
import { and, eq, isNull, max, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { requireMember } from "../auth/session";
import { can, type Actor } from "../authz";
import type { Db } from "../db";
import { categories, channels, roles, serverSettings } from "../db/schema";
import type { Hub } from "../hub";
import { planDiscordImport, type ExistingStructure } from "../import/discord";
import { DiscordTemplates, TemplateFetchError } from "../import/fetch";
import { SETTINGS_ID, broadcastStructure, type StructurePart } from "../state";

/**
 * Taking a Discord server's structure over from one of its templates (docs/features/import.md). The preview and the
 * import build the same plan from the same fetched template, so what the admin saw is what is created; the request only
 * says which of the plan's entries to create. Both need MANAGE_CHANNELS and MANAGE_ROLES: an import creates both kinds,
 * and the plan's `blocked` roles are the ones the actor may not grant (canGrant), which the import refuses too.
 */
export async function registerImportRoutes(app: FastifyInstance, db: Db, hub: Hub, templates = new DiscordTemplates()) {
  const allowed = (actor: Actor) => can(actor, Permission.MANAGE_CHANNELS) && can(actor, Permission.MANAGE_ROLES);

  async function existingStructure(): Promise<ExistingStructure> {
    const [cats, chans, rs, [settings]] = await Promise.all([
      db.select({ id: categories.id, name: categories.name }).from(categories),
      db.select({ name: channels.name, kind: channels.kind, categoryId: channels.categoryId }).from(channels),
      db.select({ name: roles.name, isDefault: roles.isDefault }).from(roles),
      db.select({ afkChannelId: serverSettings.afkChannelId }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1),
    ]);
    return { categories: cats, channels: chans, roles: rs, afkChannelId: settings?.afkChannelId ?? null };
  }

  /** The plan for a typed link or code, or the reply already sent (400 bad_code, 404, 429, 502). */
  async function planFor(input: string, actor: Actor, reply: FastifyReply): Promise<ImportPlan | null> {
    const code = discordTemplateCodeOf(input);
    if (!code) { await reply.code(400).send({ error: "bad_code" }); return null; }
    try {
      const [template, existing] = await Promise.all([templates.get(code), existingStructure()]);
      return planDiscordImport(template, existing, actor);
    } catch (e) {
      if (e instanceof TemplateFetchError) {
        const status = e.code === "unknown_template" ? 404 : e.code === "discord_rate_limited" ? 429 : 502;
        if (status === 502) app.log.warn({ err: e.message }, "Discord-Vorlage nicht abrufbar");
        await reply.code(status).send({ error: e.code });
        return null;
      }
      throw e;
    }
  }

  app.post("/api/import/discord/preview", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!allowed(m.actor)) return reply.code(403).send({ error: "forbidden" });
    const body = DiscordImportPreviewRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const plan = await planFor(body.data.code, m.actor, reply);
    if (!plan) return;
    return plan;
  });

  app.post("/api/import/discord", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!allowed(m.actor)) return reply.code(403).send({ error: "forbidden" });
    const body = DiscordImportRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const plan = await planFor(body.data.code, m.actor, reply);
    if (!plan) return;

    const wantCat = new Set(body.data.categories), wantChan = new Set(body.data.channels), wantRole = new Set(body.data.roles);
    const newCategories = plan.categories.filter((c) => c.existingId === null && wantCat.has(c.key));
    const newChannels = plan.channels.filter((c) => !c.exists && wantChan.has(c.key));
    const newRoles = plan.roles.filter((r) => !r.exists && r.blocked === null && wantRole.has(r.key));
    if (plan.roles.some((r) => wantRole.has(r.key) && r.blocked !== null)) return reply.code(403).send({ error: "cannot_grant" });
    const setAfk = body.data.afkChannel && plan.afkChannelKey !== null && wantChan.has(plan.afkChannelKey) && can(m.actor, Permission.MANAGE_SERVER);

    const result = await db.transaction(async (tx): Promise<DiscordImportResult> => {
      // Categories: after the existing ones, in the template's order.
      const categoryIds = new Map<string, string>(plan.categories.flatMap((c) => (c.existingId ? [[c.key, c.existingId] as const] : [])));
      const [topCat] = await tx.select({ m: max(categories.position) }).from(categories);
      let catPos = (topCat?.m ?? -1) + 1;
      for (const c of newCategories) {
        const [row] = await tx.insert(categories).values({ name: c.name, position: catPos++ }).returning({ id: categories.id });
        categoryIds.set(c.key, row!.id);
      }
      // Channels: after the existing ones, in the plan's order (which is Discord's display order).
      const [topChan] = await tx.select({ m: max(channels.position) }).from(channels);
      let chanPos = (topChan?.m ?? -1) + 1;
      const channelIds = new Map<string, string>();
      for (const c of newChannels) {
        const [row] = await tx.insert(channels).values({
          kind: c.kind, name: c.name, topic: c.topic, categoryId: c.categoryKey === null ? null : categoryIds.get(c.categoryKey) ?? null,
          position: chanPos++, audioBitrate: c.audioBitrate, audioStereo: false,
        }).returning({ id: channels.id });
        channelIds.set(c.key, row!.id);
      }
      // Roles: below every existing role (they are new and have no members), among themselves in the template's order.
      // The existing ones move up by as many places, so their order stays and nothing lands above anybody.
      if (newRoles.length) {
        await tx.update(roles).set({ position: sql`${roles.position} + ${newRoles.length}` }).where(eq(roles.isDefault, false));
        let rolePos = 1;
        for (const r of [...newRoles].reverse()) {
          await tx.insert(roles).values({ name: r.name, color: r.color, permissions: r.permissions, position: rolePos++ });
        }
      }
      let afkChannelSet = false;
      const afkId = setAfk && plan.afkChannelKey !== null ? channelIds.get(plan.afkChannelKey) : undefined;
      if (afkId) {
        // Only when nobody set one meanwhile; a fresh, empty channel needs no silencing and has no radio.
        const done = await tx.update(serverSettings).set({ afkChannelId: afkId })
          .where(and(eq(serverSettings.id, SETTINGS_ID), isNull(serverSettings.afkChannelId))).returning({ id: serverSettings.id });
        afkChannelSet = done.length > 0;
      }
      return { categories: newCategories.length, channels: newChannels.length, roles: newRoles.length, afkChannelSet };
    });

    const parts: StructurePart[] = [];
    if (result.categories) parts.push("categories");
    if (result.channels) parts.push("channels");
    if (result.roles) parts.push("roles");
    if (result.afkChannelSet) parts.push("settings");
    if (parts.length) await broadcastStructure(db, hub, parts);
    app.log.info({ user: m.actor.userId, code: plan.source.code, ...result }, "Discord-Vorlage importiert");
    return result;
  });
}

import { Permission, UpdateSettingsRequest } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Config } from "../config";
import type { Db } from "../db";
import { serverSettings } from "../db/schema";
import type { Hub } from "../hub";
import { SETTINGS_ID, broadcastStructure, loadSettings, loadState } from "../state";
import { compact } from "../util";

/** Server-Icon: nur Rasterbilder (SVG koennte Skripte enthalten und wuerde same-origin ausgeliefert), hoechstens 2 MB. */
const ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ICON_MAX_BYTES = 2 * 1024 * 1024;

export async function registerSettingsRoutes(app: FastifyInstance, db: Db, hub: Hub, config: Config) {
  const iconPath = join(config.DATA_DIR, "server-icon");
  await mkdir(config.DATA_DIR, { recursive: true });

  /** Gesamtzustand per REST (derselbe wie im WS-welcome), z. B. nach Reconnect. */
  app.get("/api/state", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    return loadState(db, hub, m.userId);
  });

  app.patch("/api/settings", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    const body = UpdateSettingsRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    await db.update(serverSettings).set(compact(body.data)).where(eq(serverSettings.id, SETTINGS_ID));
    await broadcastStructure(db, hub, ["settings"]);
    return { ok: true };
  });

  // ---- Server-Icon (Verwaltung > Server): Datei unter DATA_DIR/server-icon, Typ + Zeitpunkt in server_settings.
  // Der Client zeigt es in der Seitenleiste und als Favicon; /api/health nennt die URL schon vor dem Login.
  app.put("/api/settings/icon", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    const part = await req.file({ limits: { fileSize: ICON_MAX_BYTES } });
    if (!part) return reply.code(400).send({ error: "no_file" });
    if (!ICON_TYPES.has(part.mimetype)) { part.file.resume(); return reply.code(400).send({ error: "bad_type", allowed: [...ICON_TYPES] }); }
    const tmp = `${iconPath}.tmp`;
    try {
      await pipeline(part.file, createWriteStream(tmp));
      if (part.file.truncated) throw new Error("too_large");
    } catch (err) {
      await rm(tmp, { force: true });
      const tooLarge = err instanceof Error && (err.message === "too_large" || (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE");
      return reply.code(tooLarge ? 413 : 500).send({ error: tooLarge ? "too_large" : "upload_failed", maxMb: 2 });
    }
    await rename(tmp, iconPath);
    await db.update(serverSettings).set({ iconMime: part.mimetype, iconUpdatedAt: new Date() }).where(eq(serverSettings.id, SETTINGS_ID));
    await broadcastStructure(db, hub, ["settings"]);
    req.log.info({ by: m.userId, type: part.mimetype }, "Server-Icon gesetzt");
    return { ok: true, iconUrl: (await loadSettings(db)).iconUrl };
  });

  app.delete("/api/settings/icon", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    await rm(iconPath, { force: true });
    await db.update(serverSettings).set({ iconMime: null, iconUpdatedAt: null }).where(eq(serverSettings.id, SETTINGS_ID));
    await broadcastStructure(db, hub, ["settings"]);
    return { ok: true };
  });

  /** Oeffentlich (Favicon, Login-Bildschirm); die URL traegt einen Versions-Parameter, daher lange cachebar. */
  app.get("/api/server-icon", async (_req, reply) => {
    const [row] = await db.select({ iconMime: serverSettings.iconMime }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
    if (!row?.iconMime || !existsSync(iconPath)) return reply.code(404).send({ error: "not_found" });
    return reply
      .type(row.iconMime)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(createReadStream(iconPath));
  });
}

import { Permission, UpdateSettingsRequest } from "@squorli/protocol";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Config } from "../config";
import type { Db } from "../db";
import { channels, serverSettings } from "../db/schema";
import type { Hub } from "../hub";
import type { LivekitAdmin } from "../livekit/admin";
import { SETTINGS_ID, actorOf, broadcastStructure, loadSettings, loadState } from "../state";
import { compact } from "../util";
import type { DirectoryClient } from "../directory";
import type { VoicePresence } from "../voice/presence";
import { RADIO_OFF } from "./radio";

/** Server icon: raster images only (SVG could contain scripts and would be served same-origin), at most 2 MB. */
const ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ICON_MAX_BYTES = 2 * 1024 * 1024;

export async function registerSettingsRoutes(app: FastifyInstance, db: Db, hub: Hub, config: Config, directory: DirectoryClient, voice: { presence: VoicePresence; lk: LivekitAdmin; onRadioChange: () => void }) {
  /** Directory (M6d): name, listing, description, open join and icon live at the directory; re-register after a change. */
  // Debounced (1.5 s): several changes in quick succession = one registration (the directory's registration limit is 10/min).
  let reregTimer: NodeJS.Timeout | null = null;
  const reregister = () => {
    if (reregTimer) clearTimeout(reregTimer);
    reregTimer = setTimeout(() => { reregTimer = null; void directory.register().catch((err) => app.log.warn({ err }, "Verzeichnis: Neuregistrierung")); }, 1500);
    reregTimer.unref();
  };
  const iconPath = join(config.DATA_DIR, "server-icon");
  await mkdir(config.DATA_DIR, { recursive: true });
  // File gone (DATA_DIR emptied or switched) but an icon is still recorded in the DB: delete the entry, otherwise favicon,
  // sidebar, login and server rail show a broken image. Upload it again under Admin > Server.
  {
    const [row] = await db.select({ iconMime: serverSettings.iconMime }).from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
    if (row?.iconMime && !existsSync(iconPath)) {
      await db.update(serverSettings).set({ iconMime: null, iconUpdatedAt: null }).where(eq(serverSettings.id, SETTINGS_ID));
      app.log.warn({ iconPath }, "Server-Icon-Datei fehlt, Eintrag entfernt; bitte in der Verwaltung neu hochladen");
    }
  }

  /** Full state over REST (the same as in the WS welcome), e.g. after a reconnect. */
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
    // REQUIRE_ACCOUNT pinned by configuration: the admin area may not change it.
    const before = await loadSettings(db);
    if (body.data.requireAccount !== undefined && before.requireAccountLocked) return reply.code(409).send({ error: "locked_by_config" });
    const afkChannelId = body.data.afkChannelId;
    if (afkChannelId) {
      const [ch] = await db.select({ kind: channels.kind }).from(channels).where(eq(channels.id, afkChannelId)).limit(1);
      if (ch?.kind !== "voice") return reply.code(400).send({ error: "unknown_channel" });
    }
    await db.update(serverSettings).set(compact(body.data)).where(eq(serverSettings.id, SETTINGS_ID));
    const afkChanged = afkChannelId !== undefined && afkChannelId !== (before.afkChannelId ?? null);
    // The new AFK channel loses its radio; LiveKit silences whoever sits in it and gives the old one's members their grants
    // back. Current clients rejoin with a fresh token on the settings change anyway; this holds for all the others.
    if (afkChanged && afkChannelId) {
      const [off] = await db.update(channels).set(RADIO_OFF).where(and(eq(channels.id, afkChannelId), isNotNull(channels.radioStreamUrl))).returning({ id: channels.id });
      if (off) { await broadcastStructure(db, hub, ["channels"]); voice.onRadioChange(); }
      for (const vm of voice.presence.members(afkChannelId)) await voice.lk.silence(afkChannelId, vm.userId);
    }
    if (afkChanged && before.afkChannelId) {
      for (const vm of voice.presence.members(before.afkChannelId)) {
        const actor = await actorOf(db, vm.userId);
        await voice.lk.setCanStream(before.afkChannelId, vm.userId, !!actor && can(actor, Permission.STREAM_VIDEO));
      }
    }
    await broadcastStructure(db, hub, ["settings"]);
    if (body.data.name !== undefined || body.data.listed !== undefined || body.data.description !== undefined || body.data.openJoin !== undefined) reregister();
    return { ok: true };
  });

  // ---- Server icon (Admin > Server): file under DATA_DIR/server-icon, type + timestamp in server_settings.
  // The client shows it in the sidebar and as the favicon; /api/health names the URL even before sign-in.
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
    reregister();
    return { ok: true, iconUrl: (await loadSettings(db)).iconUrl };
  });

  app.delete("/api/settings/icon", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    await rm(iconPath, { force: true });
    await db.update(serverSettings).set({ iconMime: null, iconUpdatedAt: null }).where(eq(serverSettings.id, SETTINGS_ID));
    await broadcastStructure(db, hub, ["settings"]);
    reregister();
    return { ok: true };
  });

  /** Public (favicon, login screen); the URL carries a version parameter, so it is cacheable for a long time. */
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

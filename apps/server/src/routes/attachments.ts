import { Permission, type Attachment } from "@squorli/protocol";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Config } from "../config";
import type { Db } from "../db";
import { attachments } from "../db/schema";
import { attachmentUrl } from "./messages";

/**
 * Anhaenge: Datei erst hochladen (bekommt eine ID), dann per attachmentIds an eine Nachricht haengen.
 * Ablage: DATA_DIR/attachments/<id>, Metadaten in der DB. Download ist nur ueber die unerratbare ID moeglich
 * und braucht kein Token, damit <img src> funktioniert (wie bei Discord-CDN-Links). Verwaiste Uploads
 * (nie an eine Nachricht gehaengt) werden nach einer Stunde geloescht.
 */
export async function registerAttachmentRoutes(app: FastifyInstance, db: Db, config: Config) {
  const dir = join(config.DATA_DIR, "attachments");
  await mkdir(dir, { recursive: true });
  // @fastify/multipart ist in index.ts registriert (auch der Server-Icon-Upload in settings.ts nutzt es).

  app.post("/api/attachments", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.ATTACH_FILES)) return reply.code(403).send({ error: "forbidden" });
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "no_file" });
    const name = (part.filename || "datei").replace(/[\\/\0]/g, "_").slice(0, 200);
    const [row] = await db.insert(attachments).values({ uploaderId: m.userId, name, size: 0, mimeType: part.mimetype || "application/octet-stream" }).returning();
    const path = join(dir, row!.id);
    try {
      await pipeline(part.file, createWriteStream(path));
      if (part.file.truncated) throw new Error("too_large");
    } catch (err) {
      await rm(path, { force: true });
      await db.delete(attachments).where(eq(attachments.id, row!.id));
      const tooLarge = err instanceof Error && (err.message === "too_large" || (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE");
      return reply.code(tooLarge ? 413 : 500).send({ error: tooLarge ? "too_large" : "upload_failed", maxMb: config.MAX_UPLOAD_MB });
    }
    const size = (await stat(path)).size;
    await db.update(attachments).set({ size }).where(eq(attachments.id, row!.id));
    const out: Attachment = { id: row!.id, name, size, mimeType: row!.mimeType, url: attachmentUrl({ id: row!.id, name }) };
    return out;
  });

  app.get<{ Params: { id: string; name: string } }>("/api/attachments/:id/:name", async (req, reply) => {
    const [row] = await db.select().from(attachments).where(eq(attachments.id, req.params.id)).limit(1);
    const path = row ? join(dir, row.id) : null;
    if (!row || !path || !existsSync(path)) return reply.code(404).send({ error: "not_found" });
    const inline = /^(image\/|video\/|audio\/|text\/plain|application\/pdf)/.test(row.mimeType);
    return reply
      .type(row.mimeType)
      .header("content-length", row.size)
      .header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(createReadStream(path));
  });

  // Aufraeumen: verwaiste Uploads und Dateien geloeschter Nachrichten.
  async function sweep() {
    const orphanBefore = new Date(Date.now() - 3_600_000);
    const orphans = await db.delete(attachments)
      .where(and(isNull(attachments.messageId), lt(attachments.createdAt, orphanBefore)))
      .returning({ id: attachments.id });
    for (const o of orphans) await rm(join(dir, o.id), { force: true });
  }
  const timer = setInterval(() => { void sweep().catch((err) => app.log.warn({ err }, "attachment sweep")); }, 15 * 60_000);
  app.addHook("onClose", async () => clearInterval(timer));

  /** Von messages.ts nach dem Loeschen aufgerufen, damit Dateien nicht liegen bleiben. */
  app.decorate("removeAttachmentFiles", async (ids: string[]) => {
    for (const id of ids) await rm(join(dir, id), { force: true });
  });
}

declare module "fastify" {
  interface FastifyInstance {
    removeAttachmentFiles: (ids: string[]) => Promise<void>;
  }
}

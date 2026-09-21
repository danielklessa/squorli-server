import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { PREVIEW_FILE_RE, previewImageMime, type LinkPreviews } from "../previews/service";

/**
 * The pictures of link previews (docs/features/link-previews.md), copied here by the server so that a reader's client never
 * asks the linked host. Like attachments they need no token (an `<img src>` cannot send one) and are found only by their
 * name, which is the hash of their content; that also makes them cacheable for good. The bytes come from a foreign host:
 * the type is the one the server read from the bytes, never sniffed by the browser, and nothing in them may run.
 */
export async function registerPreviewRoutes(app: FastifyInstance, previews: LinkPreviews) {
  if (!previews.enabled) return;
  app.get<{ Params: { file: string } }>("/api/previews/:file", async (req, reply) => {
    const { file } = req.params;
    const path = PREVIEW_FILE_RE.test(file) ? join(previews.dir, file) : null;
    if (!path || !existsSync(path)) return reply.code(404).send({ error: "not_found" });
    return reply
      .type(previewImageMime(file))
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'")
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(createReadStream(path));
  });
}

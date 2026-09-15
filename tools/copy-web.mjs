#!/usr/bin/env node
/**
 * Copies the built web client (apps/web/dist) to apps/server/public so that
 * `node apps/server/dist/index.js` serves the client without Docker. Part of `pnpm build`.
 * In the Docker image this is done by the Dockerfile step COPY ... ./public.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "apps", "web", "dist");
const dst = join(root, "apps", "server", "public");

if (!existsSync(join(src, "index.html"))) {
  console.error(`[copy-web] ${src} enthaelt keinen gebauten Client. Erst \`pnpm --filter @squorli/web build\`.`);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`[copy-web] ${src} -> ${dst}`);

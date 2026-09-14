#!/usr/bin/env node
/**
 * Kopiert den gebauten Web-Client (apps/web/dist) nach apps/server/public, damit
 * `node apps/server/dist/index.js` ohne Docker den Client ausliefert. Teil von `pnpm build`.
 * Im Docker-Image macht das der Dockerfile-Schritt COPY ... ./public.
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

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Das Protokollpaket liegt nur als TypeScript-Quelle vor; ins Bundle aufnehmen,
  // damit dist/index.js ohne Type-Stripping und ohne Workspace-Link laeuft.
  noExternal: ["@squorli/protocol"],
  // @fastify/multipart zieht busboy nach; als extern belassen (liegt in node_modules des deploy-Outputs).
});

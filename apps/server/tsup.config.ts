import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // The protocol package only exists as TypeScript source; include it in the bundle
  // so dist/index.js runs without type stripping and without a workspace link.
  noExternal: ["@squorli/protocol"],
  // @fastify/multipart pulls in busboy; leave it external (it lives in the deploy output's node_modules).
});

import { defineConfig } from "tsup";

// Two CommonJS bundles: the main process and the (sandboxed) preload script. Everything except `electron` is bundled:
// the workspace packages only exist as TypeScript source, and a packaged app then needs no node_modules at all.
export default defineConfig({
  entry: { main: "src/main/index.ts", preload: "src/preload/index.ts" },
  outDir: "out",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  target: "node22",
  platform: "node",
  clean: true,
  external: ["electron"],
  // `noExternal` wins over `external`, so the pattern itself has to leave `electron` out (the runtime provides it).
  noExternal: [/^(?!electron$).*/],
});

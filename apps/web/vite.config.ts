import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// In dev the app server runs on 3000; everything under /api is proxied there
// so cookies/origin look like they do in production (a single domain).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", ws: true, changeOrigin: false },
    },
  },
  // Two pages: the app, and the small page a popped-out Twitch/YouTube player lives in (src/playerWindow.ts).
  build: { outDir: "dist", sourcemap: true, rollupOptions: { input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), playerWindow: fileURLToPath(new URL("./player-window.html", import.meta.url)) } } },
});

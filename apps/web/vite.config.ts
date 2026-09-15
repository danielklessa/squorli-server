import react from "@vitejs/plugin-react";
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
  build: { outDir: "dist", sourcemap: true },
});

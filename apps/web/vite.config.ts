import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Im Dev laeuft der App-Server auf 3000; alles unter /api wird dorthin durchgereicht,
// damit Cookies/Origin wie in Produktion aussehen (eine Domain).
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

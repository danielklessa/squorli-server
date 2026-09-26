// Starts the unpackaged app: `node scripts/run.mjs [--dev-url=http://localhost:5173] [--directory-url=http://localhost:3100]`.
// Editors built on Electron (VS Code) export ELECTRON_RUN_AS_NODE=1 into their terminals; with it set, Electron behaves like
// plain Node and `require("electron").app` is undefined. It is removed here, so `pnpm dev:desktop` works from such a terminal.
//
// A local `--dev-url` that does not answer (nothing on that port, `pnpm dev` not running) gets the web client's Vite dev
// server started here, straight from apps/web, and stopped again with the app (user's report of 26 September 2026: the app
// alone showed only "the dev server does not answer"). One that already answers is left alone.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron"); // path of the binary
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const isWin = process.platform === "win32";

const devUrl = process.argv.find((a) => a.startsWith("--dev-url="))?.slice("--dev-url=".length) ?? null;
const answers = async (url) => { try { return (await fetch(url, { method: "HEAD" })).ok; } catch { return false; } };

let vite = null;
if (devUrl) {
  const u = new URL(devUrl);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (local && !(await answers(devUrl))) {
    const port = u.port || "5173";
    console.log(`[desktop] no dev server at ${devUrl}: starting the web client's Vite server on port ${port}`);
    const web = join(root, "..", "web");
    vite = spawn(process.execPath, [join(web, "node_modules", "vite", "bin", "vite.js"), "--port", port, "--strictPort"], { cwd: web, stdio: "inherit", env });
  }
}

const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: "inherit", env });
const stopVite = () => {
  if (!vite || vite.exitCode !== null || !vite.pid) return;
  // Vite survives a plain kill of its parent on Windows (root AGENTS.md, "Background processes on Windows").
  if (isWin) spawnSync("taskkill", ["/T", "/F", "/PID", String(vite.pid)], { stdio: "ignore" });
  else vite.kill("SIGTERM");
};
child.on("exit", (code) => { stopVite(); process.exit(code ?? 0); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopVite(); child.kill(); });

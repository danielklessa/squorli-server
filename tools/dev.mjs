#!/usr/bin/env node
/**
 * Development start with cleanup.
 *
 *   pnpm dev            -> start the containers (Postgres, LiveKit), start the app server + web client,
 *                          and stop the containers again on exit (Ctrl+C, crash, window closed).
 *   pnpm dev --no-docker-> do not touch the containers (when you manage them yourself).
 *   pnpm dev --down     -> "compose down" instead of "compose stop" on exit (remove the containers, keep the volume).
 *
 * Platform-neutral (Windows/macOS/Linux), without dependencies. Windows quirk: child processes
 * (tsx watch, vite) do not hang off the process tree, which is why cleanup there uses taskkill /T.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read only LIVEKIT_DEV_NODE_IP from apps/server/.env for Compose. Deliberately do NOT load the whole file into process.env:
// the apps inherit our environment, and foreign values (PORT, DATABASE_URL) would otherwise land in every child process. Each app loads its own .env itself.
const serverEnv = join(root, "apps", "server", ".env");
const composeEnv = { ...process.env };
if (!composeEnv.LIVEKIT_DEV_NODE_IP && existsSync(serverEnv)) {
  const m = readFileSync(serverEnv, "utf8").match(/^\s*LIVEKIT_DEV_NODE_IP\s*=\s*"?([^"\r\n#]+?)"?\s*$/m);
  if (m) composeEnv.LIVEKIT_DEV_NODE_IP = m[1].trim();
}
if (composeEnv.LIVEKIT_DEV_NODE_IP) console.log(`[dev] LiveKit bietet ${composeEnv.LIVEKIT_DEV_NODE_IP} als Medienadresse an (LIVEKIT_DEV_NODE_IP)`);
else console.log("[dev] LiveKit bietet 127.0.0.1 als Medienadresse an: nur Browser auf diesem Rechner. Andere Geraete: LIVEKIT_DEV_NODE_IP setzen.");
const composeFile = join(root, "deploy", "compose.dev.yml");
const args = process.argv.slice(2);
const useDocker = !args.includes("--no-docker");
const stopMode = args.includes("--down") ? "down" : "stop";
const isWin = process.platform === "win32";

const compose = (...a) =>
  spawnSync("docker", ["compose", "-f", composeFile, ...a], { cwd: root, stdio: "inherit", shell: isWin, env: composeEnv });

// 1. Bring up the containers. The data volume still carries the former project's name (community-chat-dev) and is declared
// as external in compose.dev.yml; create it here once if it is missing (idempotent), otherwise compose up fails.
if (useDocker) {
  spawnSync("docker", ["volume", "create", "community-chat-dev_pgdata-dev"], { cwd: root, stdio: "ignore", shell: isWin });
  console.log("[dev] docker compose up -d (Postgres, LiveKit)");
  const r = compose("up", "-d");
  if (r.status !== 0) {
    console.error("[dev] Container konnten nicht gestartet werden. Laeuft Docker?");
    process.exit(r.status ?? 1);
  }
}

// 2. Start the apps (server + web in parallel). The directory service has its own repo (squorli-directory, run pnpm dev there).
// When the script is invoked via "pnpm dev", npm_execpath points at pnpm's JS entry point: then start pnpm directly
// with node instead of via pnpm.cmd + cmd.exe (which produces the "Terminate batch job?" prompt on Ctrl+C).
const pnpmArgs = ["-r", "--parallel", "--filter", "./apps/*", "dev"];
const viaNode = process.env.npm_execpath && /\.[cm]?js$/.test(process.env.npm_execpath);
const apps = viaNode
  ? spawn(process.execPath, [process.env.npm_execpath, ...pnpmArgs], { cwd: root, stdio: "inherit", detached: !isWin })
  : spawn("pnpm", pnpmArgs, { cwd: root, stdio: "inherit", shell: isWin, detached: !isWin });
// detached on POSIX = its own process group, so process.kill(-pid) reaches all children.

// 3. Clean up, exactly once
let cleaned = false;
function cleanup(reason, code = 0) {
  if (cleaned) return;
  cleaned = true;
  console.log(`\n[dev] beende (${reason})`);

  if (apps.exitCode === null && apps.pid) {
    if (isWin) spawnSync("taskkill", ["/T", "/F", "/PID", String(apps.pid)], { stdio: "ignore" });
    else { try { process.kill(-apps.pid, "SIGTERM"); } catch { /* already gone */ } }
  }

  if (useDocker) {
    console.log(`[dev] docker compose ${stopMode}`);
    compose(stopMode);
  }
  process.exit(code);
}

apps.on("exit", (code, signal) => cleanup(signal ? `apps: ${signal}` : `apps beendet, code ${code}`, code ?? 0));
apps.on("error", (err) => { console.error("[dev] konnte pnpm nicht starten:", err.message); cleanup("startfehler", 1); });

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => cleanup(sig, 0));
}

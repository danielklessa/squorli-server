#!/usr/bin/env node
/**
 * Entwicklungsstart mit Aufraeumen.
 *
 *   pnpm dev            -> Container (Postgres, LiveKit) starten, App-Server + Web-Client starten,
 *                          beim Beenden (Ctrl+C, Absturz, Fenster zu) die Container wieder stoppen.
 *   pnpm dev --no-docker-> Container nicht anfassen (wenn du sie selbst verwaltest).
 *   pnpm dev --down     -> beim Beenden "compose down" statt "compose stop" (Container entfernen, Volume bleibt).
 *
 * Plattformneutral (Windows/macOS/Linux), ohne Abhaengigkeiten. Windows-Besonderheit: Kindprozesse
 * (tsx watch, vite) haengen nicht am Prozessbaum, deshalb wird dort per taskkill /T aufgeraeumt.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Nur LIVEKIT_DEV_NODE_IP aus apps/server/.env fuer Compose lesen. Bewusst NICHT die ganze Datei in process.env laden:
// die Apps erben unsere Umgebung, und fremde Werte (PORT, DATABASE_URL) landen sonst in jedem Kindprozess. Jede App laedt ihre eigene .env selbst.
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

// 1. Container hochfahren. Das Datenvolume traegt noch den Namen des frueheren Projekts (community-chat-dev) und ist in
// compose.dev.yml als external deklariert; hier einmal anlegen, falls es fehlt (idempotent), sonst bricht compose up ab.
if (useDocker) {
  spawnSync("docker", ["volume", "create", "community-chat-dev_pgdata-dev"], { cwd: root, stdio: "ignore", shell: isWin });
  console.log("[dev] docker compose up -d (Postgres, LiveKit)");
  const r = compose("up", "-d");
  if (r.status !== 0) {
    console.error("[dev] Container konnten nicht gestartet werden. Laeuft Docker?");
    process.exit(r.status ?? 1);
  }
}

// 2. Apps starten (Server + Web parallel). Der Verzeichnisdienst hat sein eigenes Repo (squorli-directory, dort pnpm dev).
// Wird das Skript ueber "pnpm dev" aufgerufen, zeigt npm_execpath auf pnpms JS-Einstieg: dann pnpm direkt
// mit node starten statt ueber pnpm.cmd + cmd.exe (das erzeugt bei Ctrl+C die Nachfrage "Batchvorgang abbrechen?").
const pnpmArgs = ["-r", "--parallel", "--filter", "./apps/*", "dev"];
const viaNode = process.env.npm_execpath && /\.[cm]?js$/.test(process.env.npm_execpath);
const apps = viaNode
  ? spawn(process.execPath, [process.env.npm_execpath, ...pnpmArgs], { cwd: root, stdio: "inherit", detached: !isWin })
  : spawn("pnpm", pnpmArgs, { cwd: root, stdio: "inherit", shell: isWin, detached: !isWin });
// detached unter POSIX = eigene Prozessgruppe, damit process.kill(-pid) alle Kinder trifft.

// 3. Aufraeumen, genau einmal
let cleaned = false;
function cleanup(reason, code = 0) {
  if (cleaned) return;
  cleaned = true;
  console.log(`\n[dev] beende (${reason})`);

  if (apps.exitCode === null && apps.pid) {
    if (isWin) spawnSync("taskkill", ["/T", "/F", "/PID", String(apps.pid)], { stdio: "ignore" });
    else { try { process.kill(-apps.pid, "SIGTERM"); } catch { /* schon weg */ } }
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

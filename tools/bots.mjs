#!/usr/bin/env node
/**
 * Lasttest-Bots fuer den Sprachkanal (PLAN 5, M1: "15 Bots im Kanal duerfen den Server nicht umwerfen").
 *
 * Nutzt `lk load-test` aus dem LiveKit-CLI-Image; die Bots publizieren echtes Audio in den Raum.
 * Sie erscheinen im Web-Client als "(extern)", weil sie den App-Server umgehen.
 *
 *   pnpm bots                         15 Audio-Bots, 60 s, Raum "lobby"
 *   pnpm bots --audio 30 --duration 5m --room lobby --subscribers 5
 *   pnpm bots --video 15 --audio 0 --subscribers 1 --resolution high   M3: 15 Kamera-Bots (Simulcast), ein Zuhoerer misst Bandbreite
 *
 * Der Container haengt sich in den Netzwerk-Namensraum des LiveKit-Dev-Containers, damit die ICE-Adresse
 * 127.0.0.1 (siehe compose.dev.yml) auch fuer die Bots stimmt. Fuer einen anderen Server: --url ws://... setzen,
 * dann laeuft der Container im normalen Docker-Netz.
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };

const audio = opt("audio", "15");
const video = opt("video", "0");
const resolution = opt("resolution", "high"); // high/medium/low, nur fuer Video-Bots
const subscribers = opt("subscribers", "0");
const duration = opt("duration", "60s");
const room = opt("room", "lobby");
const url = opt("url", null);
const apiKey = process.env.LIVEKIT_API_KEY ?? "devkey";
const apiSecret = process.env.LIVEKIT_API_SECRET ?? "secret-secret-secret-secret-secret"; // wie .env.development
const isWin = process.platform === "win32";

const network = url ? [] : ["--network", "container:squorli-dev-livekit-1"];
const target = url ?? "ws://127.0.0.1:7880";

const dockerArgs = [
  "run", "--rm", ...(process.stdin.isTTY ? ["-it"] : []), ...network, "livekit/livekit-cli:latest",
  "load-test", "--url", target, "--api-key", apiKey, "--api-secret", apiSecret,
  "--room", room, "--audio-publishers", audio, "--video-publishers", video, "--video-resolution", resolution, "--video-codec", "vp8",
  "--subscribers", subscribers, "--duration", duration,
  "--identity-prefix", "bot", "--simulate-speakers",
  // Layout bestimmt, wie viele Spuren ein Zuhoerer abonniert ("speaker" = nur 6). 4x4 = alle 15 Bots.
  "--layout", opt("layout", "4x4"),
];

console.log(`[bots] ${audio} Audio-Bots, ${video} Video-Bots (${resolution}), ${subscribers} Zuhoerer, ${duration}, Raum "${room}" -> ${target}`);
const r = spawnSync("docker", dockerArgs, { stdio: "inherit", shell: isWin });
process.exit(r.status ?? 1);

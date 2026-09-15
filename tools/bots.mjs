#!/usr/bin/env node
/**
 * Load-test bots for the voice channel (PLAN 5, M1: "15 bots in a channel must not topple the server").
 *
 * Uses `lk load-test` from the LiveKit CLI image; the bots publish real audio into the room.
 * They appear in the web client as "(external)" because they bypass the app server.
 *
 *   pnpm bots                         15 audio bots, 60 s, room "lobby"
 *   pnpm bots --audio 30 --duration 5m --room lobby --subscribers 5
 *   pnpm bots --video 15 --audio 0 --subscribers 1 --resolution high   M3: 15 camera bots (simulcast), one listener measures bandwidth
 *
 * The container attaches itself to the network namespace of the LiveKit dev container so the ICE address
 * 127.0.0.1 (see compose.dev.yml) is correct for the bots as well. For another server: set --url ws://...,
 * then the container runs in the normal Docker network.
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };

const audio = opt("audio", "15");
const video = opt("video", "0");
const resolution = opt("resolution", "high"); // high/medium/low, only for video bots
const subscribers = opt("subscribers", "0");
const duration = opt("duration", "60s");
const room = opt("room", "lobby");
const url = opt("url", null);
const apiKey = process.env.LIVEKIT_API_KEY ?? "devkey";
const apiSecret = process.env.LIVEKIT_API_SECRET ?? "secret-secret-secret-secret-secret"; // same as .env.development
const isWin = process.platform === "win32";

const network = url ? [] : ["--network", "container:squorli-dev-livekit-1"];
const target = url ?? "ws://127.0.0.1:7880";

const dockerArgs = [
  "run", "--rm", ...(process.stdin.isTTY ? ["-it"] : []), ...network, "livekit/livekit-cli:latest",
  "load-test", "--url", target, "--api-key", apiKey, "--api-secret", apiSecret,
  "--room", room, "--audio-publishers", audio, "--video-publishers", video, "--video-resolution", resolution, "--video-codec", "vp8",
  "--subscribers", subscribers, "--duration", duration,
  "--identity-prefix", "bot", "--simulate-speakers",
  // The layout determines how many tracks a listener subscribes to ("speaker" = only 6). 4x4 = all 15 bots.
  "--layout", opt("layout", "4x4"),
];

console.log(`[bots] ${audio} Audio-Bots, ${video} Video-Bots (${resolution}), ${subscribers} Zuhoerer, ${duration}, Raum "${room}" -> ${target}`);
const r = spawnSync("docker", dockerArgs, { stdio: "inherit", shell: isWin });
process.exit(r.status ?? 1);

# Squorli

Self-hosted community chat with voice and video channels. Server + web/desktop client.
Modelled on Discord, but every server belongs to its operator. Plan and architecture: [`docs/PLAN.md`](docs/PLAN.md).
Working guide for developers and AI agents (commands, conventions, pitfalls, test status): [`AGENTS.md`](AGENTS.md).

**Status: M3 (video and screen share) implemented in the browser, acceptance pending.** Multiple text and voice channels in categories, roles with permissions and hierarchy, invite links, kick and ban, text chat with history, editing, deleting and attachments, admin interface, member list with online status. Voice with voice activation/push-to-talk and device selection; camera with simulcast, stage with tile and speaker view, screen share with audio (Chromium) as a separate audio track, bandwidth in the debug view. New members are "Gast" (guest: view and voice only), admins grant "Mitglied" (member). Not yet: desktop client, direct messages, reactions, audit log.

**First start:** The first user who logs in becomes the owner (or the key from `OWNER_PUBLIC_KEY`). After that the server is closed: further users need an invite link (`/invite/<code>`), which the owner creates in the admin panel (gear icon), or the server is set to "offen" (open) there.

## Structure

```
apps/server      App server (Fastify, Drizzle/Postgres, LiveKit tokens). Also serves the built web client.
apps/web         Web client (Vite + React). Later the basis for the Electron shell.
packages/protocol Shared schemas (zod) for REST and WebSocket.
deploy/          compose.yml (prod, two profiles), compose.dev.yml, Caddy, LiveKit, proxy examples
docs/PLAN.md     Project plan
```

## Development

Prerequisites: Node 22, pnpm (`corepack enable`), Docker.

```bash
pnpm install
cp .env.development apps/server/.env   # or export the variables
pnpm dev                   # starts Postgres + LiveKit in containers, then the app server on :3000 and the web client on :5173 (proxies /api to :3000)
                           # Ctrl+C stops everything, the containers are stopped automatically (data is kept)
```

Variants: `pnpm dev --no-docker` (manage the containers yourself), `pnpm dev --down` (remove the containers on exit),
`pnpm dev:apps` (apps only), `pnpm docker:dev` / `pnpm docker:dev:down` (containers manually).

Then open http://localhost:5173: a key is generated. With a running directory service (separate repo `squorli-directory`, `pnpm dev` there; `DIRECTORY_URL` in `apps/server/.env`) you can give the key a handle like `@daniel` once; it is shown on all servers that use this directory. "Anmelden und verbinden" (log in and connect) makes you the owner (first user). Channels on the left (#allgemein, Lobby), members on the right, gear icon = admin panel.
Second participant = second browser profile or incognito window (own key); it needs an invite link from the admin panel and is then "Gast" (guest: sees channels, may join voice channels). Writing, files, camera and screen only come with the role "Mitglied" (member): click the name in the member list and set the role. Join a voice channel by clicking it; mute, leave and settings at the bottom left.
Moderation (permission "Sprachkanaele moderieren" (moderate voice channels), admins have it): click the name in the member list, then move, remove from the voice channel, stop camera/screen or block camera/screen for this member (🚫 in the list). The affected member sees a notice saying who did it.
Camera: with several cameras the client always asks with a preview when switching on. Background blur (settings or 🌫️ on the stage) is computed in the browser and loads the model from the network the first time; Firefox/Safari cannot do this. The audio of shared screens can be routed in the settings to a different output device than voice (Chromium only).
Voice quality: configurable per voice channel in the admin panel (channels), Opus bitrate 24 to 256 kbit/s (default 64) and stereo for music. Connected clients switch over immediately; the stage header shows the active profile.
On joining, the stage opens in the main area: tiles per participant, buttons for microphone, camera, screen and leave; "Sprecher"/"Kacheln" (speaker/tiles) switches the view, double-click pins a tile. Clicking a text channel shows the chat again (voice and camera keep running), "Ansicht" (view) at the bottom left brings the stage back.
Screen share with audio: only in Chrome/Edge/Brave, and there only with "Tab" (tab audio) or on Windows "entire screen" with system audio. Firefox and Safari only share the picture; the stage says so then. Which combination delivers audio on your machine is checked by http://localhost:5173/test/screenshare.html (the result belongs in `docs/PLAN.md` 3.6).
Default is voice activation (threshold via slider); push-to-talk works in the browser only while the tab has focus.
Debug view (WebSocket events, packet loss, jitter): "Debug" button or http://localhost:5173/?debug.

Load test: `pnpm bots` puts 15 audio bots into the lobby for 60 s (`--audio 30 --duration 5m --subscribers 1` etc.). They appear in the client as "(extern)". Video: `pnpm bots --video 15 --audio 0 --subscribers 1 --room <channel UUID>` publishes 15 test cameras with simulcast; the `lk` table at the end shows bitrate and packet loss at the listener, the debug view in the client your own receive rates per tile.

Second device in the LAN: enter `LIVEKIT_DEV_NODE_IP=<LAN IP of the machine>` in `apps/server/.env` (or as an environment variable), `pnpm dev`, then open `http://<LAN-IP>:5173` from the other device. Testing from outside through the router: enter the public IP there and forward 7882/udp + 7881/tcp. Caution: without HTTPS the browser will not release the microphone there (`localhost` is the exception), see `docs/PLAN.md` section 5 (mkcert).

Running without Docker: `pnpm build` builds the protocol, web client and server and copies the client to `apps/server/public`; then `node apps/server/dist/index.js` (reads `apps/server/.env`).
If `/` answers with "Web-Client fehlt" (503) or `Route GET:/ not found`, the server was started without this step or the Docker image is outdated.
If login fails with `verify -> 401`, `PUBLIC_DOMAIN` does not match the hostname in the address bar (signatures are bound to the domain); the error message in the client names both values.

Migrations: change the schema in `apps/server/src/db/schema.ts`, then `pnpm db:generate`. They are applied automatically at server start.

Directory service (M6, brought forward): lives in the separate, unpublished repo `squorli-directory` (next to this one; own database, own deployment on its own host with its own domain, see its README), chat servers get `DIRECTORY_URL=https://id.example.org`. Create an account (handle + password) directly on the service's account page (`https://id.example.org/`); afterwards log in on any chat server with handle and password. The private key is stored at the service only password-encrypted (PBKDF2 + AES-GCM in the browser). It maps handles to public keys; the chat server queries it at login and shows verified handles. Each chat server registers itself there with its own key (host proof: the directory fetches the server's `/api/health`, `DIRECTORY_PROOF_URL` if that differs from `https://PUBLIC_DOMAIN/api/health`) and then reads its members' display names (global or per server, set on the account page or in the profile dialog); other servers cannot read them. If it goes down, chat keeps running without handles. On the account page (after logging in with handle + password): change password, set up an authenticator (TOTP) as a second factor for key retrieval (needs `DIRECTORY_SECRET_KEY` at the service), recovery codes, list of key retrievals. In the chat client under Profil > Geraete (profile > devices): see the logged-in sessions of this server and log them out remotely. E-mail via SMTP later. The directory part of the protocol package (`packages/protocol/src/{primitives,directory,backup,useragent}.ts`) is copied into that repo and must stay identical; the same applies to the brand package `docs/brand/`.

## Simulating restrictive networks

The M1 acceptance requires a peer in a network that blocks UDP. Without such a network this can be reproduced; the debug view (`?debug`) shows under "ICE-Weg" (ICE path) which path is actually used (`udp`, `tcp`, `relay`).

| Scenario | Reproduce | Expectation |
|---|---|---|
| Normal | nothing | `udp srflx->host` (behind NAT) or `udp host->host` |
| UDP blocked | Remove the forwarding `7882/udp` on the router (or block it inbound in the Windows firewall), join again | Connecting takes a few seconds longer, ICE path `tcp ...` via 7881 |
| UDP and direct TCP connection blocked | Open the page with `?ice=relay` and join: the browser may then only use TURN | Without active TURN: joining fails (CONNECTION_TIMEOUT). With TURN: ICE path `relay (TURN ueber tls)` |

Enabling TURN: `deploy/livekit/livekit.yaml` (certificate required, port 5349/tcp to the chat host).

## Production

```bash
cp .env.example .env       # fill in
cd deploy
docker compose --env-file ../.env --profile bundled up -d     # bundled Caddy handles TLS
# or
docker compose --env-file ../.env --profile external up -d    # your own proxy, see deploy/proxies/README.md
```

`--env-file ../.env` is required: otherwise Compose only substitutes the `${...}` placeholders in `compose.yml` from a `.env` in the `deploy/` folder, and password and LiveKit keys would remain empty.

By default Compose builds the image from this repo. To use a prebuilt image instead (the GitLab pipeline in `.gitlab-ci.yml` pushes one to the project registry on every push to the default branch and on git tags), set `APP_IMAGE=<registry>/<group>/squorli-server:<tag>` in `.env` and run `docker compose --env-file ../.env pull` before `up`.

Open ports: `443/tcp` (bundled only), `7881/tcp`, `7882/udp`. TURN is prepared but off by default (needs a certificate, see `deploy/livekit/livekit.yaml`).

## Portainer

`deploy/portainer.yml` is a self-contained stack for Portainer (web editor or git repository, path `deploy/portainer.yml`):
external mode with a reverse proxy on another host, no `env_file`, no build, no bind mounts. The LiveKit config is inlined
via `LIVEKIT_CONFIG` (keep it in step with `deploy/livekit/livekit.yaml`).

1. Registries: add `registry.klessa.net` with a GitLab deploy token (scope `read_registry`), so Portainer can pull the image
   `registry.klessa.net/squorli/squorli-server:latest` that `.gitlab-ci.yml` pushes.
2. Stacks > Add stack > paste `deploy/portainer.yml`, then enter the environment variables:

| Variable | Value |
|---|---|
| `PUBLIC_DOMAIN` | `chat.example.org`, exactly the hostname in the browser (required) |
| `POSTGRES_PASSWORD` | any secret (required) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | key name + secret with 32+ characters, e.g. `openssl rand -hex 32` (required) |
| `LIVEKIT_NODE_IP` | public IP of this host (otherwise LiveKit detects it via STUN) |
| `DIRECTORY_URL` | `https://id.example.org`, empty = no directory |
| `TRUSTED_PROXIES` | IP/CIDR of the proxy host (default: private ranges) |
| `PROXY_BIND_IP` | address on which 3000 and 7880 are published; default `0.0.0.0`, then restrict via firewall |
| `REQUIRE_ACCOUNT` | `true` forces "only with account" (login needs a directory handle, owners exempt) and locks the admin panel setting; `false` forces it off; empty = admin panel decides |
| `APP_IMAGE`, `SERVER_NAME`, `OWNER_PUBLIC_KEY`, `MAX_UPLOAD_MB`, `LIVEKIT_PUBLIC_URL`, `DIRECTORY_PROOF_URL` | optional, see `.env.example` |

3. Proxy (e.g. Nginx Proxy Manager): `https://PUBLIC_DOMAIN` -> `http://<host>:3000` with WebSocket support, plus a location
   `/rtc` -> `http://<host>:7880` (WebSocket); details in `deploy/proxies/README.md`. Firewall: `7881/tcp` and `7882/udp` open
   to everyone, `3000` and `7880` only for the proxy host.
4. Check: `https://PUBLIC_DOMAIN/api/health` shows `domain` and `serverKey`; `https://PUBLIC_DOMAIN/rtc/validate` returns 401.

## License

Not decided yet (MIT or Apache 2.0). Until then: all rights reserved.

## Smoke test

With the server running (`pnpm dev` or `node dist/index.js`), `pnpm smoke` checks the complete flow:
challenge, signature, replay protection, profile, LiveKit token, WebSocket handshake, voice channel presence, protocol version.

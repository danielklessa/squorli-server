# Project Plan: Self-Hosted Community Chat with Voice and Video

Status: 13 September 2026 · Draft v0.3 · Solo development · Open source

---

## 1. Fixed constraints

| Item | Decision |
|---|---|
| Model | Discord (server → channels → roles), but every server self-hosted |
| Video | Up to 15 simultaneous cameras per channel |
| Clients (Release 1) | Web (browser) and desktop (Windows, macOS, Linux) |
| Identity | One account for all servers, attached to a later online service |
| Development | One person, TypeScript/Node, delivered as Docker containers |
| License | Permissive, MIT or Apache 2.0 (choice between the two, see section 9) |
| Speaking | Push-to-talk and voice activation, user chooses per device |
| Screen share with audio | Mandatory in Release 1, browser and desktop (limitations, see 3.6) |
| Operation | Standalone with bundled proxy **or** behind an existing reverse proxy (see 4.5) |

---

## 2. Positioning

The strongest competitor in the same segment is Stoat (formerly Revolt): Discord-like, self-hostable, AGPL-3. Its well-known weakness is precisely voice and video; according to public reports, screen sharing was still under construction as of early 2026. The positioning follows from that:

**Not "yet another Discord clone", but: the self-hosted server where voice and video work as well as on commercial services – and which is up and running in ten minutes.**

Two consequences for the priorities:

1. Media quality (latency, stability, echo/noise suppression, screen share with audio) comes before feature breadth (emojis, threads, bots).
2. The initial setup is a product feature. One `docker compose up`, one domain, done. Everything the operator has to set up on top of that costs users.

---

## 3. Architecture

### 3.1 Components

```
                       ┌────────────────────────────────────┐
   Browser / Desktop   │  Reverse proxy (Caddy)             │  :443
   ──────────────────► │  TLS automatic via Let's Encrypt   │
                       └───────┬────────────────────┬───────┘
                               │                    │
                    ┌──────────▼──────────┐ ┌───────▼────────────┐
                    │  App server         │ │  Media server      │ :7881 TCP
                    │  Node / TypeScript  │ │  LiveKit (Go)      │ UDP port(s)
                    │  REST + WebSocket   │ │  SFU + TURN        │
                    │  Auth, channels,    │ │  Simulcast, E2EE   │
                    │  roles, chat        │ │                    │
                    └──────────┬──────────┘ └────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
     ┌──────▼──────┐  ┌────────▼────────┐  ┌──────▼──────┐
     │  PostgreSQL │  │  Object storage │  │  Redis      │
     │  Data       │  │  Attachments/   │  │  (optional) │
     │             │  │  avatars        │  │             │
     └─────────────┘  └─────────────────┘  └─────────────┘
```

**Why LiveKit instead of a custom SFU:** Writing an SFU in TypeScript yourself (e.g. with mediasoup as a library) is not realistic for one person with the goal "15 cameras, stable" on top of everything else. LiveKit brings simulcast, SVC, TURN, speaker detection, selective subscription to streams and a JS client SDK. The price: a dependency in Go that you cannot maintain yourself. That is a deliberate trade of control for feasibility.

**What the app server does not do:** It does not transport media. It manages who is allowed in which channel and issues a short-lived join token for LiveKit for that purpose. Media signaling runs directly between client and LiveKit.

**Redis:** To my knowledge not strictly required for a single LiveKit node; mandatory for multi-node operation. Leave it out for Release 1, but provide a Compose profile for it. To be verified.

**Object storage:** In Release 1 a Docker volume with a local file system is sufficient. S3-compatible interface (MinIO, Garage) as a configurable alternative, not as a requirement.

### 3.2 Identity: Key Pair plus Directory

The chosen path is the one that allows a cross-server account without any server depending on the online service at runtime.

- **Account = key pair** (Ed25519), generated on the client. The permanent identity towards every server is the public key.
- **Login to a server:** Challenge-response. The server sends a random value, the client signs it, the server verifies and issues a session. No password ever leaves the device, because there is none.
- **Profile per server:** Display name, avatar, roles live on the server. A user can have a different name on different servers (like Discord server nicknames).
- **Online service (brought forward, see M6):** Maps a handle (`@name`) to a public key, offers encrypted key backup, device management and a server directory. On login, a server asks whether a key belongs to a verified handle and displays it; if the service is down, the last known state remains.
- **Recovery:** The unsolved problem of this model. Planned: recovery code (mnemonic words, stored locally) from Release 1 on; encrypted backup with the online service later. Without the service, key loss = account loss. The user interface must state this unmistakably.

**Assumption built in here:** Users accept "no password, but a recovery code instead". That is plausible for the target group "self-hosters and their communities", but not proven. Plan for early user feedback on this.

### 3.3 Real-Time Protocol

One WebSocket between client and app server for everything except media: presence, channel state (who is where), chat messages, role changes, typing indicators.

- Messages as typed JSON events, schema in a shared package (e.g. with `zod`), from which server and client types are derived. One source of truth.
- Versioned protocol number in the handshake from day one, so that old clients can be detected.
- Reconnection with state reconciliation (sequence number), not "reload everything".

### 3.4 Client

**One web client that is packaged as a desktop app.** Not two clients.

- **Web:** TypeScript, React (or a lighter framework, if you are more familiar with one), Vite. LiveKit JS SDK for media.
- **Desktop:** Electron. Rationale: screen sharing including system audio, global keyboard shortcuts (push-to-talk), autostart and tray are mature in Electron. Tauri would be leaner, but to my knowledge less mature for exactly these functions; that is an assessment, not an established fact, and is worth a two-day prototype to verify before milestone 4 begins.
- **Shared core:** State, protocol client, media logic in one package without UI dependency, so that a later mobile client can reuse it.

### 3.5 Speaking: Push-to-Talk and Voice Activation

Both are offered, the choice is up to the user and is stored per device.

- **Voice activation:** Local level measurement via the Web Audio API (AnalyserNode or AudioWorklet), threshold with slider and live display, hold time of a few hundred milliseconds so that word endings are not cut off. Below the threshold the microphone track is muted, not unpublished, so that switching back on is instantaneous.
- **Push-to-talk in the desktop client:** Global keyboard shortcut via Electron, works even with the window minimized. Optionally a mouse button. Short tone on activation as feedback.
- **Push-to-talk in the browser:** Only possible while the tab has focus; browsers do not allow global keyboard shortcuts. That is a platform limit, not an implementation gap. The user interface says so clearly when it is enabled and recommends the desktop client.
- **Default choice:** Voice activation, because it works without explanation. Push-to-talk is offered as an alternative on first join.

### 3.6 Screen Share with Audio

Mandatory for Release 1, but the browsers impose hard limits that no code gets around. Status September 2026, from public sources, with uncertainties marked:

| Environment | Video | Audio | Confidence |
|---|---|---|---|
| Chromium (Chrome, Edge, Brave) – share browser tab | yes | yes, tab audio, all operating systems | confirmed |
| Chromium – entire screen, Windows | yes | yes, system audio after opt-in in the dialog | confirmed |
| Chromium – entire screen, macOS / Linux | yes | unclear, depending on the source now possible | **verify** |
| Chromium – single window | yes | to my knowledge no | **verify** |
| Firefox | yes | no, rated low priority by Mozilla | confirmed |
| Safari | yes | no to my knowledge | **verify** |
| Desktop client, Windows | yes | yes, system audio via loopback (Electron/Chromium) | probable, verify |
| Desktop client, macOS | yes | system audio needs an additional path (ScreenCaptureKit or virtual audio device) | **verify**, considerable effort possible |
| Desktop client, Linux | yes | conceivable via PipeWire/PulseAudio monitor, Wayland complicates video capture | **verify**, can be documented as a limitation |

What follows from this:

1. **Officially supported in Release 1:** Screen share with audio in Chromium browsers and in the desktop client on Windows. Everything else: video without audio with a clear notice in the user interface, not silently.
2. **Work through the test matrix:** The test page for this has been at `/test/screenshare.html` since M3 (shipped with the client, in dev at http://localhost:5173/test/screenshare.html). For each browser and operating system try tab, window and entire screen and replace the "verify" rows above. Status 2026-09-13: not yet filled in.
3. **macOS system audio in the desktop client** is the most expensive row. If the verification effort turns out to be high, it will be documented as a known limitation for Release 1 instead of blocking the release.
4. **Technically:** The audio of the share is published as a separate audio track, not mixed with the microphone. That way listeners can control it separately and the presenter does not hear themselves twice. To be verified whether LiveKit handles multiple audio tracks per participant cleanly (to my knowledge yes).

### 3.7 Repository Structure

```
/
├── apps/
│   ├── server/        Node/TS app server
│   ├── web/           Web client
│   └── desktop/       Electron shell around web/
├── packages/
│   ├── protocol/      Event schemas, shared types
│   ├── core/          Client logic without UI
│   └── ui/            Components (optional, later)
├── deploy/
│   ├── compose.yml            Production
│   ├── compose.dev.yml        Development
│   └── caddy/, livekit/       Configuration templates
├── docs/
└── tools/                     Load-test bots, seed scripts
```

Monorepo with pnpm workspaces or comparable. A single `pnpm dev` starts everything.

---

## 4. Network and delivery

This is the part where self-hosted voice fails in practice. Hence the detail here.

### 4.1 What the operator has to bring

- A public IPv4 address (or IPv6 plus an understanding of the consequences) and the ability to open ports.
- A domain pointing at the server.
- A rented server or VPS. A full 15-camera channel produces roughly 60 Mbit/s of upload (estimate, see 4.3). Home connections are usually too weak for that. This belongs prominently in the docs, otherwise there will be disappointed users and bad reviews.

### 4.2 Ports

- **443 TCP:** Everything over HTTPS/WSS through Caddy (app server, web client, LiveKit signaling).
- **7881 TCP:** LiveKit media fallback for networks that block UDP.
- **UDP:** LiveKit supports a single multiplexed UDP port instead of a range. For self-hosters that is a big difference (one port instead of thousands). Use it by default.
- **TURN:** LiveKit ships with a built-in TURN server. It needs TLS over 443 or 5349 to get through restrictive firewalls. Configure it via Caddy forwarding, do not demand it from the operator.

Goal for standalone operation: **Open two ports (443 TCP, one UDP port), the rest just works.** If that does not work out, delivery is not finished. For operation behind an existing proxy, section 4.5 applies.

### 4.3 Bandwidth: measurement (M3) and projection

First measurement on 13 September 2026, locally (Docker Desktop, Windows): `pnpm bots --video 15 --audio 0 --subscribers 1`, 15 simulated cameras (LiveKit preset "high", VP8, simulcast with three layers), one listener with a 4×4 tile layout, 60 s.

| Where | Direction | Measured | Projection |
|---|---|---|---|
| Client | Download (15 tiles) | **4.1 Mbit/s** total, 236–309 kbit/s per track, packet loss 0.03 % | matches the old estimate (≈ 4 Mbit/s) |
| Client | Upload (camera 720p, simulcast 180/360/720) | client default: max. ~1.7 Mbit/s (720p) or ~0.4 Mbit/s (360p setting); the debug view shows the layers live | 1–2 Mbit/s |
| Server | Download (ingest) | not measured (the bots run in the network namespace of the LiveKit container, `docker stats` does not see the traffic) | 15 × ~1.5 Mbit/s ≈ 20 Mbit/s |
| Server | Upload (distribution) | one listener = 4.1 Mbit/s | 15 listeners ≈ 60 Mbit/s |
| Server | CPU / RAM (LiveKit) | ~9 % of one core, ~135 MB with 15 cameras + 1 listener | linear with listeners, no transcoding |

Thanks to `adaptiveStream`, the tile view only fetches the simulcast layer that matches the tile size; a speaker focus with a large tile pulls the 720p layer (~1.5 Mbit/s) for that one track and 180p for the small tiles. Still open: the same measurement with real cameras over the internet (M3 acceptance) and the ingest on the server (`docker stats` on the target host there, not locally).

CPU stays moderate as long as media is only forwarded. Recording and server-side transcoding would tip that over and stay out of release 1.

### 4.4 Delivery

- `deploy/compose.yml` with four services: caddy, app, livekit, postgres. Caddy sits in a Compose profile (`standalone`) and is dropped in proxy mode. One `.env` with three mandatory values: domain, admin handle, database password, plus `PROXY_MODE=bundled|external`. Everything else has sensible defaults.
- A setup script or setup page on first start that checks: domain reachable? Ports open? UDP arriving? With clear error messages. This self-diagnosis saves more support than any documentation.
- Versioned images, database migrations automatically at startup, backup guide (Postgres dump plus file volume).

### 4.5 Operation behind an existing reverse proxy

Requirement: The server must also run when port 443 already belongs to a foreign proxy (Traefik, nginx, Nginx Proxy Manager, Caddy, Apache). For self-hosters that is the normal case.

**What goes through the proxy and what does not:**

| Traffic | Through the proxy? | Note |
|---|---|---|
| Web client, REST, app WebSocket | yes | Proxy must pass on the WebSocket upgrade; with nginx this has to be configured explicitly |
| LiveKit signaling (WebSocket) | yes | Route the path `/rtc` to the LiveKit container. To my knowledge LiveKit serves this path natively, so no rewrite is needed; to be verified |
| Media UDP | **no** | HTTP proxies do not transport UDP. The port must go directly to the LiveKit container |
| Media TCP fallback (7881) | **no** | Separate port, passed through directly, not via the proxy |
| TURN over TLS | **no** | Cannot sit on 443 in proxy mode because the port is taken |

**Consequences for the implementation:**

1. **Two operating modes, one image.** `PROXY_MODE=bundled` starts Caddy with automatic TLS. `PROXY_MODE=external` starts no Caddy, the app server and LiveKit listen unencrypted on internal ports, and TLS is terminated by the foreign proxy. Both modes use the same container images and the same configuration, only the profile differs.
2. **Trust proxy headers, but only the right ones.** In external mode the app server reads `X-Forwarded-For` and `X-Forwarded-Proto` for rate limits, logs and secure cookies. Which senders are trusted is configurable (`TRUSTED_PROXIES`), default: the Docker network. Without this restriction any client could spoof its IP.
3. **TURN in proxy mode.** Default: TURN/TLS on port 5349 with its own certificate, which the operator provides or LiveKit obtains itself. That is less firewall-friendly than 443, but honest. Documented for advanced users: SNI-based TCP passthrough at the proxy (Traefik TCP router, nginx `stream` with `ssl_preread`, Caddy `layer4`), so that a subdomain like `turn.chat.example.org` on 443 is passed straight through to LiveKit. Not as a requirement, because that overwhelms many operators.
4. **Public IP for ICE.** LiveKit must know its public address in order to offer it to clients. Default: automatic detection (`use_external_ip`), overridable via `NODE_IP` for operators with multiple addresses or without working auto-detection.
5. **Subdomain only, no sub-path.** `chat.example.org` yes, `example.org/chat` no. Sub-path operation creates special cases in client routing, asset paths and LiveKit signaling that are not worth the effort. Named in the docs as a deliberate limit.
6. **Self-diagnosis knows both modes.** In external mode the setup check additionally tests: Does the WebSocket get through the proxy? Is `X-Forwarded-Proto` correct? Is the UDP port reachable from outside even though 443 lives elsewhere? The error messages name the suspected proxy fault explicitly ("WebSocket upgrade is not being passed on").
7. **Ship reference configurations** under `deploy/proxies/`: Traefik (Docker labels), nginx, Nginx Proxy Manager (guide with screenshots), Caddy. Ready to copy, tested, part of the CI check at least for nginx and Traefik. This is the part that decides adoption, not the code behind it.

**New minimum requirement in proxy mode:** The proxy forwards HTTPS and WebSocket to the internal app; in addition, one UDP port, 7881 TCP and 5349 TCP must get through directly to the server. Three ports instead of two, because 443 is no longer available.

---

## 5. Development environment

Explicitly planned, because you asked for it.

- **`compose.dev.yml`** starts Postgres and LiveKit in containers; app server and web client run locally with hot reload. LiveKit in dev mode without TLS, with fixed keys.
- **Proxy mode testable locally:** A second dev profile with Traefik or nginx in front, so that header handling, WebSocket forwarding and `/rtc` routing are not discovered only at the user's site.
- **Local TLS:** Browsers require a secure context for camera/microphone. `localhost` counts as secure; for tests from other devices on the LAN, mount `mkcert` certificates into Caddy.
- **Fake media:** The Chromium flags `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream` allow tests without a real camera and without permission dialogs. A script that starts Chromium this way.
- **Load-test bots:** Use the LiveKit server SDK (Node) to put N bot participants into a channel that publish test video. That lets you test 15 cameras alone at your desk. Build it early (milestone 1), it pays off throughout.
- **Seed data:** Script that creates a server with channels, roles and users, so you do not start from zero every time.
- **Tests:** Vitest for protocol and server logic, Playwright for end-to-end in the browser (including joining a voice channel with fake media). Do not aim for 100 % coverage; protocol and permission checks must be tested, UI details need not be.
- **CI:** Lint, types, tests, Docker build on every push. Release images on tag.
- **Protocol inspector:** A hidden debug view in the client that shows WebSocket events and LiveKit statistics (bitrate, packet loss, selected simulcast layer) live. Indispensable for media problems.

---

## 6. Milestones

The order is chosen so that **every milestone delivers something usable** and the riskiest part comes early. Effort figures are rough estimates for one person working part-time and serve only for proportion, not for scheduling.

### M0 – Foundation (small)
Monorepo, Compose for dev and prod, Caddy with automatic TLS, app server skeleton with Postgres migrations, protocol package with handshake, key pair generation and challenge-response login in the client, LiveKit container attached.
**Done when:** A fresh VPS runs after a Compose start with a valid certificate, the same works behind an existing nginx in external mode, and a client can log in with a key.

### M1 – Two people talking (medium)
One fixed voice channel. Join, leave, mute, speaker indication, device selection. Load-test bots. Debug view.
**Done when:** You and a second person can talk stably from two different networks (at least one with restrictive NAT, e.g. a mobile hotspot), and 15 bots in the channel do not knock the server over.
**Why so early:** This is the biggest technical risk. If it stalls here, the architecture has to change before much code sits on top of it.

### M2 – Server structure (large)
Multiple channels (voice and text), categories, roles with permissions, invite links, kick/ban, simple text chat with history, attachments. Admin area.
**Done when:** A small community could use the server as a replacement for a simple Discord server, without video.

### M3 – Video and screen share (medium to large)
Camera on/off, tile view with simulcast layers depending on tile size, speaker focus, screen share in the browser with audio as a separate audio track (Chromium officially, other browsers picture without audio with a notice, see 3.6). Bandwidth measurement, adjustment of the defaults. This is where the difference to the competition arises; plan time for polish accordingly.
**Done when:** 15 real cameras (or bots with realistic test video) run smoothly on a defined target server, a screen share with tab audio from Chrome arrives at everyone, and the bandwidth table in section 4.3 has been replaced by measured values.

### M4 – Desktop client (medium)
Electron shell: push-to-talk with a global hotkey, screen share with system audio (Windows for sure; macOS and Linux depending on the result of the test matrix in 3.6), tray, autostart, notifications, auto-update. Before that the Tauri prototype from 3.4, if you want to keep the decision open.
**Done when:** Installers for all three platforms drop out of CI, PTT works with the window minimized, and system audio is shared on Windows.

### M5 – Operational readiness and first public release (medium)
Setup self-diagnosis for both operating modes, reference configurations for Traefik, nginx, Nginx Proxy Manager and Caddy, backup/restore guide, migration safety, rate limits, logging, documentation for operators and users, recovery code flow, security review of the auth path.
**Done when:** A stranger following the docs has a running server in under 15 minutes, both standalone and behind an existing Traefik or nginx, and you would announce the project publicly.

### M6 – Online service (medium; pulled forward, own repo `squorli-directory`)
Handle registration, mapping handle → public key, encrypted key backup, device management, server directory with join via link, server registration by operators. The service is deliberately so narrow that it can fail without crippling servers.

**Decision of 14 September 2026:** M6 is built before M4/M5, because without a backup every browser reset is a lost account. The service lives in its own, unpublished repo `squorli-directory` next to this one (decision of 14 September 2026: it is not published with the chat; until then it was `apps/directory` in the monorepo). It carries a synchronized copy of the directory part of the protocol package and of the brand package, runs with its own database on its own host with its own subdomain; several chat servers share one service. Second factor: TOTP authenticator. E-mail (SMTP) is prepared in configuration and schema, but will be implemented later.

| Phase | Content | Status |
|---|---|---|
| M6a | Register a handle (proof of ownership by signature), resolution in both directions, chat server shows verified handles | done 14 September 2026 |
| M6b | Password-encrypted key backup (PBKDF2 + HKDF + AES-GCM in the client, the service only sees ciphertext and the hash of an auth key), account page of the service for creating an account with handle + password and for changing the password, login on any chat server with handle + password | done 14 September 2026 |
| M6c | TOTP authenticator as second factor for key retrieval and account changes (secret encrypted with `DIRECTORY_SECRET_KEY`, each code only once), ten recovery codes (hashed only), device management: sessions per chat server with device label and remote logout (WebSocket close 4011) plus list of key retrievals on the account page; e-mail confirmation as soon as SMTP arrives | done 14 September 2026 (without e-mail) |
| M6c+ | Display names in the directory: one global name and one per chat server (override), set signed on the account page or in the chat profile dialog; chat servers take them at login and refresh them on `GET /api/me`; the names are readable only by the registered chat server of that host | done 14 September 2026 |
| M6d (1/2) | Server registration: each chat server has its own key, registers at the directory with a signature and a host proof (the directory fetches the server's `/api/health` and compares `serverKey`), gets a 24-h token and may then read only its own users' names; the directory records logins per server for the account page, pushes name changes to the servers concerned and the servers re-sync all users every 5 minutes | done 14 September 2026 |
| M6d (2/2) | Server directory: servers opt in (`listed` + description in the admin panel), the directory keeps their icon (fetched from the proven host at registration) and serves list and icons publicly; client: server rail with the own handle's servers (icons from the directory) and a "Server entdecken" modal, join via link to the server's origin | done 14 September 2026 |

**Not in release 1:** Mobile clients, recording, end-to-end encryption of media, bot API, threads, federation between servers.

---

## 7. Risks

| Risk | Impact | Handling |
|---|---|---|
| NAT/TURN does not work for some operators | Users cannot join, frustration, bad reviews | Self-diagnosis during setup, TCP fallback, TURN over 443, docs with "what your host must be able to do" |
| Key loss without the online service | Account gone | Recovery code from M0, clear warnings, backup at the service from M6 |
| Audio quality below Discord level | Core promise not delivered | Use the browser's own echo/noise suppression, test Opus parameters, possibly evaluate RNNoise in the client; measurement with real users in M1 |
| Operator's proxy forwards WebSockets or headers incorrectly | Chat works, voice does not; hard to diagnose | Reference configurations, self-diagnosis with proxy-specific error messages, mandatory subdomain |
| TURN in proxy mode only on 5349 instead of 443 | Users on very restrictive networks cannot get in | SNI passthrough as a documented advanced path; diagnosis shows whether TURN is reachable |
| Screen share with audio outside Chromium/Windows | Core feature missing on Firefox, Safari, partly macOS/Linux | Work through the test matrix early (3.6), name the limits in the UI, recommend the desktop client as the way out |
| LiveKit dependency (Go, third-party project) | Bugs you cannot fix yourself; license change | Pin the version, upgrade tests in CI, keep the abstraction layer in the server so thin that a switch remains conceivable |
| Scope creep towards the Discord feature list | Never finished | Take the section "Not in release 1" seriously; check every new feature against the positioning |
| Bus factor 1 | Project dies during a pause | Docs, clear structure, go public early so contributors can get on board |

---

## 8. Technology candidates (to verify)

My knowledge of versions and maturity is a snapshot; check the current state before committing to each one.

| Area | Candidate | Note |
|---|---|---|
| Media server | LiveKit | Go, Docker image, JS SDK, built-in TURN. Check the license in the repo (Apache 2.0 as far as I know) |
| App server | Node + Fastify or Hono | Both lightweight; check WebSocket support |
| ORM/migrations | Drizzle or Prisma | Drizzle closer to SQL, Prisma more convenient; a matter of taste |
| Schemas | zod | For the protocol package and validation |
| Web client | React + Vite | Or whatever you are more familiar with |
| Desktop | Electron (Tauri as a candidate to evaluate) | See 3.4 |
| Proxy/TLS | Caddy | Automatic Let's Encrypt without configuration |
| Tests | Vitest, Playwright | |
| Monorepo | pnpm workspaces, possibly Turborepo | |

---

## 9. Open decisions

These must be made before M0 or at the latest before the respective milestone:

Already decided: permissive license, PTT and voice activation both, screen share with audio in release 1.

1. **MIT or Apache 2.0.** Both allow everything including closed forks. Apache 2.0 additionally contains an explicit patent license from contributors and matches LiveKit's license; MIT is shorter and more common in the JS world. In substance hardly any difference for this project. I am not a lawyer; if in doubt, a brief review. Consequence of the permissive choice: code from Stoat (AGPL-3) must not be adopted, it may only serve as reference.
2. **Text chat depth in release 1:** channel messages only, or also direct messages, reactions, edit/delete. *Provisional (M2, 13 September 2026, not confirmed): channel messages with edit/delete, no DMs/reactions/threads.*
3. **Moderation:** Who may do what, audit log yes/no, report function yes/no. *Provisional (M2): role permissions + kick/ban, no audit log, no report function. **Decided (13 September 2026):** The default role "Gast" (guest) may only see channels and join voice channels; "Mitglied" (member: write, files, invites, camera/screen) is assigned by admins. Moderators (permission "Sprachkanäle moderieren", moderate voice channels) move members between voice channels, end camera/screen and block camera/screen per member; LiveKit enforces this server-side.*
4. **Name of the project.** **Decided (14 September 2026): Squorli.** Brand and design in `docs/brand/` (version 2, dark mode, blue signet with three speech figures); package names `@squorli/*`, Compose projects `squorli`/`squorli-dev`, image tags `squorli/app` and `squorli/directory`. Signed messages (`community-chat-login`, `community-directory-*`, HKDF infos `community-backup-*`) and the localStorage keys keep their old identifiers so that existing backups and sessions remain valid.
5. **Tauri prototype yes/no** before M4. Note: With system audio as a requirement, Electron's maturity weighs more heavily; a Tauri prototype would have to prove exactly this function.
6. **macOS system audio in the desktop client:** release-1 requirement or documented limitation, depending on the result of the test matrix.

---

## 10. Next concrete steps

1. Settle the license text (MIT or Apache 2.0) and the project name.
2. Work through the test matrix from 3.6 with a small test page: getDisplayMedia with `audio: true` in Chrome, Firefox, Safari on all available operating systems; replace the "prüfen" (check) rows with the result. One afternoon.
3. Start LiveKit locally via Docker, open a room with the bundled example client, put 15 bots in, watch resources. One day. Confirms or refutes the component choice before code is written.
4. Set up the monorepo, start M0.

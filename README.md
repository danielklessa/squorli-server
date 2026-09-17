# Squorli Server

Homepage: **https://squorli.com**

Self-hosted, open-source community chat with text, voice and video channels, similar to Discord. Every server belongs to the person who runs it. Squorli Server includes the browser client; a desktop client is planned.

Official repository: [Squorli Server on GitHub](https://github.com/danielklessa/squorli-server). Licensed under the [Apache License 2.0](LICENSE). A server can optionally connect to the [Squorli Directory](https://directory.squorli.com), a separately operated service that gives users a global handle, lets them find friends across servers and exchange end-to-end encrypted direct messages. Without a directory, a server works completely on its own.

This README explains how to run your own Squorli server. Working on the code: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What you get

- Text channels with history, editing, deleting and attachments; voice channels with voice activation or push-to-talk.
- Mentions with `@name` suggestions, a highlight for messages that mention you and counters per channel and server.
- Markdown in messages (formatting, lists and task lists, tables, code blocks with a copy button) and emoji: an emoji picker, `:shortcodes:` and emoticons such as `:)`, shown in an emoji font that your own server delivers, so they look the same on every system and no font service is involved.
- Camera and screen share (screen audio in Chromium browsers), tile and speaker view.
- Categories, roles with permissions and hierarchy, invite links, kick and ban, admin panel in the browser.
- Optional connection to a Squorli Directory for global handles, friends and end-to-end encrypted direct messages.

Not yet: desktop client, reactions, audit log. Current status of the implementation: [AGENTS.md](AGENTS.md).

Third-party software, fonts and data inside the client are listed with their licenses in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and in the client under Settings > Licenses; see also [NOTICE](NOTICE).

## Requirements

- A Linux host with Docker and Docker Compose (v2).
- A domain that points to the host, for example `chat.example.org`. Browsers only release microphone and camera over HTTPS.
- Open ports: `443/tcp` (only if the bundled Caddy terminates TLS), `7881/tcp` and `7882/udp` (media, open to everyone).
- Roughly 1 GB RAM for the app server, Postgres and LiveKit together; more with many simultaneous video streams.

The stack consists of the app server (this repository, including the web client), Postgres and [LiveKit](https://livekit.io) as media server. Everything runs from `deploy/compose.yml`.

## Quick start with the published image

The public image is **`ghcr.io/danielklessa/squorli-server:latest`** (tags and digests: [container package](https://github.com/danielklessa/squorli-server/pkgs/container/squorli-server)). You still need a checkout of this repository for the Compose files and the mounted LiveKit and Caddy configuration; no local build is required.

```bash
git clone https://github.com/danielklessa/squorli-server.git
cd squorli-server
cp .env.example .env
```

Fill in `.env`. Required values:

| Variable | Value |
|---|---|
| `PUBLIC_DOMAIN` | `chat.example.org`, exactly the hostname users type in the browser |
| `POSTGRES_PASSWORD` | any secret |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | key name plus a secret with 32+ characters, e.g. `openssl rand -hex 32` |
| `PROXY_MODE` | `bundled` (Caddy in the stack handles TLS on 443) or `external` (your own reverse proxy, see below) |
| `APP_IMAGE` | `ghcr.io/danielklessa/squorli-server:latest`; pin a version tag or digest for production |

Then start the stack from `deploy/`. `--env-file ../.env` is required: otherwise Compose only substitutes the placeholders in `compose.yml` from a `.env` inside `deploy/`, and password and LiveKit keys would remain empty.

```bash
cd deploy
docker compose --env-file ../.env --profile bundled pull
docker compose --env-file ../.env --profile bundled up -d --no-build
```

With `PROXY_MODE=external` use `--profile external` and the matching proxy overlay in **both** commands (see [Reverse proxy](#reverse-proxy)).

Check: `https://PUBLIC_DOMAIN/api/health` shows `domain` and `serverKey`; `https://PUBLIC_DOMAIN/rtc/validate` returns 401.

## First start

The first user who logs in becomes the owner (or the key given in `OWNER_PUBLIC_KEY`). After that the server is closed: further users need an invite link (`/invite/<code>`), which the owner creates in the admin panel (gear icon), or the server is set to "open" there.

New members are guests (view and voice only). Admins grant the member role via the member list, which unlocks writing, files, camera and screen share.

Guests hear a voice channel but do not see what others share there: without the permission "Watch camera and screen shares" a member receives no camera, screen share or screen audio. The member role has it; to let guests watch too, tick it on the guest role (admin panel, Roles). When updating an existing server, every role except the guest role receives the permission automatically. The restriction works once everybody in the channel runs a client that knows the permission (reload the page after updating the server).

## Configuration

All variables are documented in [.env.example](.env.example). The most relevant optional ones:

| Variable | Purpose |
|---|---|
| `SERVER_NAME` | Initial name of the server (changeable in the admin panel) |
| `OWNER_PUBLIC_KEY` | Public key (64 hex) that becomes owner on first login |
| `MAX_UPLOAD_MB` | Upper limit for attachments, default 25 |
| `LIVEKIT_NODE_IP` | Public IP of the host; empty = LiveKit detects it via STUN |
| `LIVEKIT_PUBLIC_URL` | Only if clients should not reach LiveKit via `https://PUBLIC_DOMAIN/rtc` |
| `DIRECTORY_URL` | `https://directory.squorli.com` or your own directory; empty = no directory |
| `DIRECTORY_PROOF_URL` | Only if the directory cannot reach `https://PUBLIC_DOMAIN/api/health` directly |
| `REQUIRE_ACCOUNT` | `true` forces login with a directory handle (owners exempt), `false` forces it off, empty = admin panel decides |
| `TRUSTED_PROXIES` | External mode: IPs/CIDRs whose `X-Forwarded-*` headers are trusted (default: private ranges) |
| `PROXY_BIND_IP` | External mode with the proxy on another host: address on which 3000 and 7880 listen |

Voice quality (Opus bitrate, stereo) is configured per voice channel in the admin panel.

## Reverse proxy

With `PROXY_MODE=external` an existing reverse proxy terminates TLS and forwards to the app server on port 3000 and LiveKit on port 7880:

- `https://PUBLIC_DOMAIN` -> `http://<host>:3000` with WebSocket support
- `https://PUBLIC_DOMAIN/rtc` -> `http://<host>:7880` (WebSocket)

Firewall: `7881/tcp` and `7882/udp` open to everyone, `3000` and `7880` only for the proxy host. Ready-made configurations and Compose overlays for nginx, Nginx Proxy Manager, Plesk and Traefik, plus verification steps, are in [deploy/proxies/README.md](deploy/proxies/README.md).

TURN for clients in networks that block UDP and direct TCP is prepared but off by default; it needs a certificate and port `5349/tcp`, see `deploy/livekit/livekit.yaml`.

## Portainer

`deploy/portainer.yml` is a self-contained stack for Portainer (web editor or git repository, path `deploy/portainer.yml`): external mode with a reverse proxy on another host, no `env_file`, no build, no bind mounts. The LiveKit config is inlined via `LIVEKIT_CONFIG` (keep it in step with `deploy/livekit/livekit.yaml`).

1. Stacks > Add stack > paste `deploy/portainer.yml`.
2. Enter the environment variables: `PUBLIC_DOMAIN`, `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (required); `APP_IMAGE=ghcr.io/danielklessa/squorli-server:latest` (set explicitly, pin a tag or digest for production); optionally `LIVEKIT_NODE_IP`, `DIRECTORY_URL`, `TRUSTED_PROXIES`, `PROXY_BIND_IP` (default `0.0.0.0`, then restrict via firewall), `REQUIRE_ACCOUNT`, `SERVER_NAME`, `OWNER_PUBLIC_KEY`, `MAX_UPLOAD_MB`, `LIVEKIT_PUBLIC_URL`, `DIRECTORY_PROOF_URL`. Meaning as in [Configuration](#configuration).
3. Set up the proxy and firewall as in [Reverse proxy](#reverse-proxy).
4. Check `https://PUBLIC_DOMAIN/api/health` and `https://PUBLIC_DOMAIN/rtc/validate` (401).

## Updates

1. Back up the database, attachments and configuration.
2. Review the release notes.
3. Repeat `pull` and `up -d --no-build` with the same profile and overlays.

`latest` is mutable; for reproducible deployments set `APP_IMAGE` to a version tag or `ghcr.io/danielklessa/squorli-server@sha256:<digest>` and keep the repository checkout aligned with that release. Startup runs database migrations; an image rollback does not reverse them.

## Building from source

Unset `APP_IMAGE` in `.env` and run from `deploy/`:

```bash
docker compose --env-file ../.env --profile bundled up -d --build   # or the external profile with overlays
```

## Troubleshooting

- `/` answers "Web-Client fehlt" (503) or `Route GET:/ not found`: the image is outdated or the server was started without the built web client.
- Login fails with `verify -> 401`: `PUBLIC_DOMAIN` does not match the hostname in the address bar. Signatures are bound to the domain; the error message in the client names both values.
- Microphone or camera not available: the page must be served over HTTPS (`localhost` is the only exception).
- Voice connects slowly or not at all: check that `7882/udp` and `7881/tcp` reach the host. The client's debug view (`?debug` in the URL) shows the active ICE path (`udp`, `tcp`, `relay`).

## License

Squorli Server is licensed under the [Apache License, Version 2.0](LICENSE) (Copyright 2026 Daniel Klessa, see [NOTICE](NOTICE)). Contributions are accepted under the same license. The Squorli Directory is a separately operated service and is not part of this repository.## Production (standard: published Docker image, no Git clone)

Requirements: Docker Engine with the Compose plugin, curl and OpenSSL on a Linux host. You do not need Git, Node.js or a local application build. Point your domain to the host and open 80/tcp, 443/tcp, 7881/tcp and 7882/udp. Follow the complete guide in [English](https://squorli.com/en/docs/install/) or [German](https://squorli.com/de/docs/install/).

Create a new installation directory and download only the deployment configuration:

```bash
mkdir -p squorli/deploy/caddy squorli/deploy/livekit squorli/deploy/proxies
cd squorli
curl -fL https://raw.githubusercontent.com/danielklessa/squorli-server/main/.env.example -o .env
curl -fL https://raw.githubusercontent.com/danielklessa/squorli-server/main/deploy/compose.yml -o deploy/compose.yml
curl -fL https://raw.githubusercontent.com/danielklessa/squorli-server/main/deploy/caddy/Caddyfile -o deploy/caddy/Caddyfile
curl -fL https://raw.githubusercontent.com/danielklessa/squorli-server/main/deploy/livekit/livekit.yaml -o deploy/livekit/livekit.yaml
curl -fL https://raw.githubusercontent.com/danielklessa/squorli-server/main/deploy/proxies/nginx.ports.yml -o deploy/proxies/nginx.ports.yml
```

Run the download step only once in a fresh directory; repeating it overwrites configuration. Edit .env, replace the hostname and secrets, set PROXY_MODE=bundled and APP_IMAGE=ghcr.io/danielklessa/squorli-server:latest. Generate separate secrets with `openssl rand -hex 32`. Reserve the first login with OWNER_PUBLIC_KEY or restrict access until you claim ownership. The nginx overlay is only needed for an external proxy.

```bash
cd deploy
docker compose --env-file ../.env --profile bundled pull
docker compose --env-file ../.env --profile bundled up -d --no-build
```

Always pass `--env-file ../.env`. The downloaded Compose file also describes a source build; `--no-build` explicitly uses the published image and needs no Dockerfile or source checkout. Caddy, PostgreSQL and LiveKit are started alongside the app.



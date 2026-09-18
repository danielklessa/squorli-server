import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { DirectoryLeaveRequest, DirectoryNotifyRequest, PROTOCOL_VERSION, RADIO_IDLE_STOP_MS } from "@squorli/protocol";
import { and, eq, isNotNull } from "drizzle-orm";
import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import { registerAuthRoutes } from "./auth/routes";
import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";
import { createDb, runMigrations } from "./db";
import { channels } from "./db/schema";
import { Hub } from "./hub";
import { LivekitAdmin } from "./livekit/admin";
import { registerLivekitRoutes } from "./livekit/routes";
import { registerAttachmentRoutes } from "./routes/attachments";
import { registerChannelRoutes } from "./routes/channels";
import { registerInviteRoutes } from "./routes/invites";
import { registerMemberRoutes } from "./routes/members";
import { registerMessageRoutes } from "./routes/messages";
import { registerReadStateRoutes } from "./routes/readState";
import { RADIO_OFF, registerRadioRoutes } from "./routes/radio";
import { RadioIdleStop } from "./radio/idle";
import { RadioMetadata } from "./radio/metadata";
import { registerRoleRoutes } from "./routes/roles";
import { registerSettingsRoutes } from "./routes/settings";
import { deleteUserAccount, type DeleteUserResult } from "./users/deleteUser";
import { registerUserRoutes } from "./users/routes";
import { DirectoryClient, SYNC_INTERVAL_MS } from "./directory";
import { broadcastStructure, loadChannels, loadSettings, setRequireAccountForced } from "./state";
import { AfkMover } from "./voice/afk";
import { VoicePresence } from "./voice/presence";
import { registerWs } from "./ws/handler";

const here = dirname(fileURLToPath(import.meta.url));
/** Version from the server's package.json (dev: apps/server, container: /app); the client shows it on the login screen. */
const VERSION = ((): string => {
  try { return (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: string }).version ?? "0"; } catch { return "0"; }
})();

/**
 * Load an optional .env next to the package (apps/server/.env), without an extra dependency.
 * Environment variables that are already set take precedence. If the file is missing, nothing happens.
 * In the container the configuration comes exclusively from the environment.
 */
function loadDotEnv() {
  const file = join(here, "..", ".env");
  if (!existsSync(file)) return;
  try { process.loadEnvFile(file); } catch (err) { console.warn(`Konnte ${file} nicht laden:`, err); }
}

async function main() {
  loadDotEnv();
  const config = loadConfig();

  const app = Fastify({
    logger: { level: config.NODE_ENV === "production" ? "info" : "debug" },
    // In external mode we trust X-Forwarded-* only from the configured proxies.
    // In bundled mode the only proxy is our own Caddy inside the Docker network.
    trustProxy: config.trustedProxies,
  });

  const { db, client } = createDb(config.DATABASE_URL);
  // Migrations folder: in dev relative to src, in the build relative to dist -> both point at ../drizzle
  await runMigrations(db, join(here, "..", "drizzle"));

  // CORS for all origins: the web client of another Squorli server talks to this server directly (multi-server client,
  // server rail). Auth runs exclusively through the bearer token in the header (no cookies), and the login signature stays bound to
  // PUBLIC_DOMAIN; so a foreign origin cannot do anything on the user's behalf without holding their token.
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Directory integration (M6): server key + token; init() after bootstrap (settings), register() after app.listen.
  let directory: DirectoryClient | null = null;
  // Push from the directory after a name change (DirectoryNotifyRequest): reload the user. Set as soon as the reconciliation is running.
  let notifyHandler: ((publicKey: string) => Promise<void>) | null = null;
  app.post("/api/directory/notify", async (req, reply) => {
    const body = DirectoryNotifyRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    if (!notifyHandler) return reply.code(404).send({ error: "no_directory" });
    void notifyHandler(body.data.publicKey).catch((err) => req.log.warn({ err }, "Verzeichnis-Push"));
    return reply.code(204).send();
  });
  // Push from the directory: the user asked (signed, at the directory) to delete their account on this server. The push carries
  // only the key; the server confirms with its own token (the directory answers 200 only for a pending request of this host),
  // so a stranger can at most trigger a check. Handled synchronously: the directory reports `delivered` to the user.
  let leaveHandler: ((publicKey: string) => Promise<DeleteUserResult>) | null = null;
  app.post("/api/directory/leave", async (req, reply) => {
    const body = DirectoryLeaveRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    if (!leaveHandler) return reply.code(404).send({ error: "no_directory" });
    const r = await leaveHandler(body.data.publicKey);
    if (r === "deleted" || r === "not_found") return reply.code(204).send();
    return reply.code(r === "unavailable" ? 502 : 409).send({ error: r });
  });
  app.get("/api/health", async () => ({
    ok: true,
    proxyMode: config.PROXY_MODE,
    /** Public server key; the directory checks it during server registration (host proof). */
    serverKey: directory?.serverKey ?? null,
    /** Server name and icon for the page title and favicon even before sign-in (both are also visible in the invite preview). */
    ...(await loadSettings(db).then((st) => ({ serverName: st.name, iconUrl: st.iconUrl, requireAccount: st.requireAccount && !!config.DIRECTORY_URL }))
      .catch(() => ({ serverName: null, iconUrl: null, requireAccount: false }))),
    version: VERSION,
    /** Directory service (M6) that this server recognizes; the client registers handles there. null = none. */
    directoryUrl: config.DIRECTORY_URL ?? null,
    /** Domain that login signatures are bound to; the client compares it against its hostname. */
    domain: config.PUBLIC_DOMAIN,
    protocolVersion: PROTOCOL_VERSION,
    time: new Date().toISOString(),
  }));

  setRequireAccountForced(config.REQUIRE_ACCOUNT ?? null);
  if (config.REQUIRE_ACCOUNT !== undefined && !config.DIRECTORY_URL) app.log.warn("REQUIRE_ACCOUNT gesetzt, aber ohne DIRECTORY_URL wirkungslos (kein Verzeichnis, keine Kontopruefung)");
  await bootstrap(db, config, app.log);
  directory = new DirectoryClient(db, config, app.log);
  await directory.init();

  const hub = new Hub();
  const presence = new VoicePresence<WebSocket>();
  // Online and AFK status change everyone's member list.
  hub.onPresence(() => { void broadcastStructure(db, hub, ["members"]).catch((err) => app.log.warn({ err }, "presence broadcast")); });
  const lk = new LivekitAdmin(config, app.log);

  // AFK channel: absent members of a voice channel are moved there (voice/afk.ts), right when they turn absent (below) and
  // every few seconds, because a video that kept its channel's members from being moved ends without any event here.
  const afkMover = new AfkMover();
  const afkSweep = async () => {
    const afk = hub.afkUsers();
    const settings = afk.length ? await loadSettings(db) : null;
    const afkChannelId = settings?.afkChannelId ?? null;
    const exemptChannels = new Set(afkChannelId ? (await loadChannels(db)).filter((c) => c.radio?.twitchChannel || c.radio?.youtubeVideo).map((c) => c.id) : []);
    const due = afkMover.due({ afkChannelId, afk, channelOf: (userId) => presence.channelOfUser(userId), exemptChannels });
    for (const { userId, from } of due) {
      hub.sendToUser(userId, { type: "voice.moved", channelId: afkChannelId, by: settings!.name, reason: "afk" });
      app.log.info({ userId, from }, "Mitglied in den AFK-Kanal verschoben");
    }
  };
  const afkTimer = setInterval(() => { void afkSweep().catch((err) => app.log.warn({ err }, "afk sweep")); }, 5_000);
  app.addHook("onClose", async () => clearInterval(afkTimer));
  hub.onPresence(() => { void afkSweep().catch((err) => app.log.warn({ err }, "afk sweep")); }); // right away when somebody turns absent

  // Web radio "now playing": the server reads a station's titles only while somebody sits in a voice channel playing it.
  const radioMeta = new RadioMetadata((channelId, title) => hub.broadcast({ type: "radio.meta", channelId, title }), app.log);
  // Nobody left in the channel: its radio goes off after two minutes (setting radioAutoStop). Checked again when the time is up.
  const radioIdle = new RadioIdleStop((channelId) => {
    void (async () => {
      if (presence.members(channelId).length > 0 || !(await loadSettings(db)).radioAutoStop) return;
      const [row] = await db.update(channels).set(RADIO_OFF).where(and(eq(channels.id, channelId), isNotNull(channels.radioStreamUrl))).returning({ id: channels.id });
      if (!row) return;
      app.log.info({ channelId }, "Radio beendet: Kanal leer");
      await broadcastStructure(db, hub, ["channels"]);
      syncRadioMeta();
    })().catch((err) => app.log.warn({ err }, "radio idle stop"));
  }, config.RADIO_IDLE_STOP_MS ?? RADIO_IDLE_STOP_MS);
  const syncRadioMeta = () => {
    void Promise.all([loadChannels(db), loadSettings(db)]).then(([all, settings]) => {
      const playing = all.filter((c) => c.radio);
      radioMeta.sync(playing.flatMap((c) => (!c.radio!.twitchChannel && !c.radio!.youtubeVideo && presence.members(c.id).length > 0 ? [{ channelId: c.id, streamUrl: c.radio!.streamUrl, stationName: c.radio!.name }] : [])));
      radioIdle.sync(settings.radioAutoStop ? playing.filter((c) => presence.members(c.id).length === 0).map((c) => c.id) : []);
    }).catch((err) => app.log.warn({ err }, "radio sync"));
  };
  const offRadioPresence = presence.onChange(syncRadioMeta);
  const radioMetaTimer = setInterval(syncRadioMeta, 30_000); // safety net for changes that pass no hook (a deleted channel, the setting)
  syncRadioMeta(); // a radio left running before a restart
  app.addHook("onClose", async () => { offRadioPresence(); clearInterval(radioMetaTimer); radioMeta.close(); radioIdle.close(); });

  // Uploads (attachments, server icon): one file per request, size per MAX_UPLOAD_MB.
  await app.register(multipart, { limits: { fileSize: Math.round(config.MAX_UPLOAD_MB * 1024 * 1024), files: 1 } });
  await registerAuthRoutes(app, db, config, hub, directory);
  await registerUserRoutes(app, db, directory, hub, presence);
  await registerSettingsRoutes(app, db, hub, config, directory, { presence, lk, onRadioChange: syncRadioMeta });
  await registerChannelRoutes(app, db, hub, presence);
  await registerRoleRoutes(app, db, hub, presence, lk);
  await registerMemberRoutes(app, db, hub, presence, lk);
  await registerInviteRoutes(app, db);
  await registerMessageRoutes(app, db, hub);
  await registerReadStateRoutes(app, db, hub);
  await registerRadioRoutes(app, db, hub, syncRadioMeta);
  await registerAttachmentRoutes(app, db, config);
  await registerLivekitRoutes(app, db, config);
  await registerWs(app, db, hub, presence, radioMeta, lk);

  // The built web client is served by the same process (one container less).
  const staticDir = config.STATIC_DIR ?? join(here, "..", "public");
  if (existsSync(join(staticDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: staticDir,
      // wildcard: true (the default) resolves files on every request. With false, one route per existing file would be
      // registered at startup; after `pnpm build` without a restart, new asset hashes would only produce 404s.
      wildcard: true,
      cacheControl: false, // we set cache-control ourselves (see setHeaders)
      // Hashed assets may be cached for a long time, the pages (index.html, player-window.html) never: otherwise, after a
      // deploy, a browser would point at asset names that no longer exist.
      setHeaders: (res, path) => {
        res.setHeader("cache-control", path.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0] ?? "";
      if (path.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      // Missing files (with an extension) get a 404, not the app shell. Otherwise a stale asset link
      // returns text/html and the browser reports "Expected a JavaScript module ... MIME type text/html".
      if (/\.[a-z0-9]{1,8}$/i.test(path)) return reply.code(404).type("text/plain").send("not found");
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  } else {
    // Without a built web client only the API runs. Instead of a bare 404 on "/", say what is missing.
    app.log.warn({ staticDir }, "Web-Client nicht gefunden (kein index.html). Nur die API ist erreichbar. " +
      "Abhilfe: `pnpm build` im Repo (kopiert apps/web/dist nach apps/server/public), Docker-Image neu bauen, oder STATIC_DIR setzen.");
    // Bilingual (German/English) by Accept-Language, English by default: the same rule the web client applies.
    const expected = join(staticDir, "index.html");
    const texts = {
      de: [
        "Squorli: API läuft, aber der Web-Client fehlt.",
        `Erwartet wurde ${expected}.`,
        "Abhilfe: im Repo `pnpm build` ausführen (legt apps/server/public an) oder das Docker-Image neu bauen;",
        "alternativ STATIC_DIR auf ein Verzeichnis mit dem gebauten Client zeigen lassen.",
        "Prüfen: GET /api/health",
      ],
      en: [
        "Squorli: the API is running, but the web client is missing.",
        `Expected ${expected}.`,
        "Fix: run `pnpm build` in the repo (creates apps/server/public) or rebuild the Docker image;",
        "alternatively point STATIC_DIR at a directory with the built client.",
        "Check: GET /api/health",
      ],
    };
    app.get("/", async (req, reply) => reply.code(503).type("text/plain; charset=utf-8").send([...texts[preferredLanguage(req.headers["accept-language"])], ""].join("\n")));
  }

  app.addHook("onClose", async () => { await client.end(); });

  // Common mistake: the dev value for LiveKit's client URL on a public server.
  const lkUrl = new URL(config.livekitPublicUrl);
  const lkHost = lkUrl.hostname;
  if (lkUrl.protocol === "wss:" && lkUrl.port && lkUrl.port !== "443") {
    app.log.warn({ livekitPublicUrl: config.livekitPublicUrl },
      "LIVEKIT_PUBLIC_URL nennt einen Port: Clients erwarten LiveKit hinter dem Proxy unter wss://PUBLIC_DOMAIN (Port 443, Pfad /rtc). " +
      "Port 7880 spricht kein TLS und ist von außen nicht erreichbar. Variable entfernen, wenn der Proxy /rtc weiterleitet.");
  }
  if (config.PUBLIC_DOMAIN !== "localhost" && (lkHost === "localhost" || lkHost === "127.0.0.1")) {
    app.log.warn({ livekitPublicUrl: config.livekitPublicUrl, domain: config.PUBLIC_DOMAIN },
      "LIVEKIT_PUBLIC_URL zeigt auf localhost, PUBLIC_DOMAIN aber nicht: fremde Clients können LiveKit so nicht erreichen. " +
      "Variable entfernen (Standard wss://PUBLIC_DOMAIN) oder auf die öffentliche Adresse setzen.");
  }

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  app.log.info({ proxyMode: config.PROXY_MODE, domain: config.PUBLIC_DOMAIN }, "app-server up");
  if (directory.enabled) {
    // Register, then reconcile all users' names every 5 minutes (changes on the account page arrive without a reload this way).
    // Account deletion requested through the directory: founder check, confirm there (token), then delete locally.
    leaveHandler = (publicKey) => deleteUserAccount(app, db, hub, presence, publicKey, () => directory!.confirmLeave(publicKey));
    const sync = async () => {
      for (const key of await directory!.pendingLeaves()) await leaveHandler!(key);
      const changed = await directory!.syncAll((u) => presence.rename(u.userId, { displayName: u.displayName, publicKey: u.publicKey, handle: u.handle }));
      if (changed) await broadcastStructure(db, hub, ["members"]);
    };
    void directory.register().then(() => sync()).catch((err) => app.log.warn({ err }, "Verzeichnis-Abgleich"));
    notifyHandler = async (publicKey) => {
      const changed = await directory!.syncOne(publicKey, (u) => presence.rename(u.userId, { displayName: u.displayName, publicKey: u.publicKey, handle: u.handle }));
      if (changed) await broadcastStructure(db, hub, ["members"]);
    };
    const timer = setInterval(() => { void sync().catch((err) => app.log.warn({ err }, "Verzeichnis-Abgleich")); }, SYNC_INTERVAL_MS);
    timer.unref(); // does not keep the process alive (no more hooks are possible after app.listen)
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

/** "de" when German ranks before English in the Accept-Language header (or is the only known language), otherwise "en". */
export function preferredLanguage(header: string | string[] | undefined): "de" | "en" {
  const raw = Array.isArray(header) ? header.join(",") : header ?? "";
  const ranked = raw.split(",").map((part, i) => {
    const [tag = "", ...params] = part.trim().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { lang: tag.trim().toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
  }).filter((e) => e.lang === "de" || e.lang === "en").sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked[0]?.lang === "de" ? "de" : "en";
}

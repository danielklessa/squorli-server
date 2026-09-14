import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { DirectoryNotifyRequest, PROTOCOL_VERSION } from "@squorli/protocol";
import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import { registerAuthRoutes } from "./auth/routes";
import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";
import { createDb, runMigrations } from "./db";
import { Hub } from "./hub";
import { LivekitAdmin } from "./livekit/admin";
import { registerLivekitRoutes } from "./livekit/routes";
import { registerAttachmentRoutes } from "./routes/attachments";
import { registerChannelRoutes } from "./routes/channels";
import { registerInviteRoutes } from "./routes/invites";
import { registerMemberRoutes } from "./routes/members";
import { registerMessageRoutes } from "./routes/messages";
import { registerRoleRoutes } from "./routes/roles";
import { registerSettingsRoutes } from "./routes/settings";
import { registerUserRoutes } from "./users/routes";
import { DirectoryClient, SYNC_INTERVAL_MS } from "./directory";
import { broadcastStructure, loadSettings, setRequireAccountForced } from "./state";
import { VoicePresence } from "./voice/presence";
import { registerWs } from "./ws/handler";

const here = dirname(fileURLToPath(import.meta.url));
/** Version aus der package.json des Servers (dev: apps/server, Container: /app); der Client zeigt sie im Login. */
const VERSION = ((): string => {
  try { return (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: string }).version ?? "0"; } catch { return "0"; }
})();

/**
 * Optionale .env neben dem Paket (apps/server/.env) laden, ohne Zusatzabhaengigkeit.
 * Bereits gesetzte Umgebungsvariablen haben Vorrang. Fehlt die Datei, passiert nichts.
 * Im Container kommt die Konfiguration ausschliesslich ueber die Umgebung.
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
    // Im external-Modus glauben wir X-Forwarded-* nur den konfigurierten Proxys.
    // Im bundled-Modus ist der einzige Proxy unser eigener Caddy im Docker-Netz.
    trustProxy: config.trustedProxies,
  });

  const { db, client } = createDb(config.DATABASE_URL);
  // Migrationsordner: im Dev relativ zu src, im Build relativ zu dist -> beide zeigen auf ../drizzle
  await runMigrations(db, join(here, "..", "drizzle"));

  // CORS fuer alle Origins: der Web-Client eines anderen Squorli-Servers spricht diesen Server direkt an (Multi-Server-Client,
  // Server-Leiste). Auth laeuft ausschliesslich ueber das Bearer-Token im Header (keine Cookies), die Login-Signatur bleibt an
  // PUBLIC_DOMAIN gebunden; ein fremder Origin kann also nichts im Namen des Nutzers tun, ohne dessen Token zu besitzen.
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Verzeichnis-Anbindung (M6): Server-Schluessel + Token; init() nach bootstrap (Einstellungen), register() nach app.listen.
  let directory: DirectoryClient | null = null;
  // Push vom Verzeichnis nach einer Namensaenderung (DirectoryNotifyRequest): Nutzer neu laden. Gesetzt, sobald der Abgleich laeuft.
  let notifyHandler: ((publicKey: string) => Promise<void>) | null = null;
  app.post("/api/directory/notify", async (req, reply) => {
    const body = DirectoryNotifyRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    if (!notifyHandler) return reply.code(404).send({ error: "no_directory" });
    void notifyHandler(body.data.publicKey).catch((err) => req.log.warn({ err }, "Verzeichnis-Push"));
    return reply.code(204).send();
  });
  app.get("/api/health", async () => ({
    ok: true,
    proxyMode: config.PROXY_MODE,
    /** Oeffentlicher Server-Schluessel; das Verzeichnis prueft ihn bei der Server-Registrierung (Host-Nachweis). */
    serverKey: directory?.serverKey ?? null,
    /** Servername und Icon fuer Seitentitel und Favicon schon vor dem Login (beides ist auch in der Einladungsvorschau sichtbar). */
    ...(await loadSettings(db).then((st) => ({ serverName: st.name, iconUrl: st.iconUrl, requireAccount: st.requireAccount && !!config.DIRECTORY_URL }))
      .catch(() => ({ serverName: null, iconUrl: null, requireAccount: false }))),
    version: VERSION,
    /** Verzeichnisdienst (M6), den dieser Server anerkennt; der Client registriert Handles dort. null = keiner. */
    directoryUrl: config.DIRECTORY_URL ?? null,
    /** Domain, an die Login-Signaturen gebunden sind; der Client vergleicht sie mit seinem Hostnamen. */
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
  // Online-Status aendert die Mitgliederliste aller.
  hub.onPresence(() => { void broadcastStructure(db, hub, ["members"]).catch((err) => app.log.warn({ err }, "presence broadcast")); });

  // Uploads (Anhaenge, Server-Icon): eine Datei je Anfrage, Groesse nach MAX_UPLOAD_MB.
  await app.register(multipart, { limits: { fileSize: Math.round(config.MAX_UPLOAD_MB * 1024 * 1024), files: 1 } });
  await registerAuthRoutes(app, db, config, hub, directory);
  await registerUserRoutes(app, db, directory, hub, presence);
  await registerSettingsRoutes(app, db, hub, config, directory);
  await registerChannelRoutes(app, db, hub, presence);
  await registerRoleRoutes(app, db, hub);
  await registerMemberRoutes(app, db, hub, presence, new LivekitAdmin(config, app.log));
  await registerInviteRoutes(app, db);
  await registerMessageRoutes(app, db, hub);
  await registerAttachmentRoutes(app, db, config);
  await registerLivekitRoutes(app, db, config);
  await registerWs(app, db, hub, presence);

  // Gebauter Web-Client wird vom selben Prozess ausgeliefert (ein Container weniger).
  const staticDir = config.STATIC_DIR ?? join(here, "..", "public");
  if (existsSync(join(staticDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: staticDir,
      // wildcard: true (Standard) loest Dateien bei jeder Anfrage auf. Mit false wuerde beim Start eine Route je
      // vorhandener Datei registriert; nach `pnpm build` ohne Neustart gaebe es fuer neue Asset-Hashes nur 404.
      wildcard: true,
      cacheControl: false, // wir setzen cache-control selbst (siehe setHeaders)
      // Gehashte Assets duerfen lange gecacht werden, die Shell (index.html) nie: sonst zeigt ein Browser nach
      // einem Deploy auf Asset-Namen, die es nicht mehr gibt.
      setHeaders: (res, path) => {
        res.setHeader("cache-control", path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0] ?? "";
      if (path.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      // Fehlende Dateien (mit Endung) bekommen 404, nicht die App-Shell. Sonst liefert ein veralteter
      // Asset-Link text/html und der Browser meldet "Expected a JavaScript module ... MIME type text/html".
      if (/\.[a-z0-9]{1,8}$/i.test(path)) return reply.code(404).type("text/plain").send("not found");
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  } else {
    // Ohne gebauten Web-Client laeuft nur die API. Statt einer nackten 404 auf "/" sagen, was fehlt.
    app.log.warn({ staticDir }, "Web-Client nicht gefunden (kein index.html). Nur die API ist erreichbar. " +
      "Abhilfe: `pnpm build` im Repo (kopiert apps/web/dist nach apps/server/public), Docker-Image neu bauen, oder STATIC_DIR setzen.");
    app.get("/", async (_req, reply) => reply.code(503).type("text/plain; charset=utf-8").send([
      "Squorli: API läuft, aber der Web-Client fehlt.",
      `Erwartet wurde ${join(staticDir, "index.html")}.`,
      "Abhilfe: im Repo `pnpm build` ausführen (legt apps/server/public an) oder das Docker-Image neu bauen;",
      "alternativ STATIC_DIR auf ein Verzeichnis mit dem gebauten Client zeigen lassen.",
      "Prüfen: GET /api/health",
      "",
    ].join("\n")));
  }

  app.addHook("onClose", async () => { await client.end(); });

  // Haeufiger Fehler: Dev-Wert fuer die Client-URL von LiveKit auf einem oeffentlichen Server.
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
    // Registrieren, dann alle 5 Minuten die Namen aller Nutzer abgleichen (Aenderungen auf der Kontoseite kommen so ohne Neuladen an).
    const sync = async () => {
      const changed = await directory!.syncAll((u) => presence.rename(u.userId, { displayName: u.displayName, publicKey: u.publicKey, handle: u.handle }));
      if (changed) await broadcastStructure(db, hub, ["members"]);
    };
    void directory.register().then(() => sync()).catch((err) => app.log.warn({ err }, "Verzeichnis-Abgleich"));
    notifyHandler = async (publicKey) => {
      const changed = await directory!.syncOne(publicKey, (u) => presence.rename(u.userId, { displayName: u.displayName, publicKey: u.publicKey, handle: u.handle }));
      if (changed) await broadcastStructure(db, hub, ["members"]);
    };
    const timer = setInterval(() => { void sync().catch((err) => app.log.warn({ err }, "Verzeichnis-Abgleich")); }, SYNC_INTERVAL_MS);
    timer.unref(); // haelt den Prozess nicht am Leben (nach app.listen sind keine Hooks mehr moeglich)
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

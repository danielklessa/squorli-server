import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_DOMAIN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  PROXY_MODE: z.enum(["bundled", "external"]).default("bundled"),
  TRUSTED_PROXIES: z.string().default("127.0.0.1"),
  /** Interne URL zum LiveKit-Server (Server-zu-Server, z. B. RoomService). */
  LIVEKIT_URL: z.string().url(),
  /**
   * URL, die Clients fuer die Medienverbindung bekommen (ohne Pfad, das SDK haengt /rtc an).
   * Standard: wss://PUBLIC_DOMAIN, also ueber den Proxy. Im Dev ohne Proxy: ws://localhost:7880.
   */
  LIVEKIT_PUBLIC_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(16),
  STATIC_DIR: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  /** Verzeichnis fuer Anhaenge (Docker: Volume). */
  DATA_DIR: z.string().default("./data"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  /**
   * Oeffentlicher Schluessel, der beim ersten Login Eigentuemer wird. Leer = der erste Nutzer,
   * der sich anmeldet, solange noch kein Eigentuemer existiert.
   */
  OWNER_PUBLIC_KEY: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Anfangsname des Servers; spaeter in den Einstellungen aenderbar. */
  SERVER_NAME: z.string().min(1).max(64).default("Community"),
  /**
   * Verzeichnisdienst (M6): oeffentliche Basis-URL, z. B. https://chat.example.org/id. Der Server loest beim Login
   * Schluessel -> Handle auf und gibt die URL an Clients weiter (Registrierung im Browser). Leer = ohne Verzeichnis.
   */
  DIRECTORY_URL: z.string().url().optional(),
  /**
   * URL, unter der das Verzeichnis die /api/health dieses Servers erreicht (Host-Nachweis bei der Server-Registrierung).
   * Standard: https://PUBLIC_DOMAIN/api/health; bei PUBLIC_DOMAIN=localhost http://localhost:PORT/api/health (Dev).
   */
  DIRECTORY_PROOF_URL: z.string().url().optional(),
  /**
   * "Nur mit Konto" beim Deployment fest vorgeben: true/false ueberschreibt die Einstellung aus der Verwaltung (dort dann
   * gesperrt). Leer = die Verwaltung entscheidet. Wirkt nur mit DIRECTORY_URL.
   */
  REQUIRE_ACCOUNT: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").optional(),
});

export type Config = z.infer<typeof Env> & { trustedProxies: string[]; livekitPublicUrl: string; directoryProofUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Ungueltige Konfiguration:\n${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    trustedProxies: c.TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter(Boolean),
    livekitPublicUrl: (c.LIVEKIT_PUBLIC_URL ?? `wss://${c.PUBLIC_DOMAIN}`).replace(/\/+$/, ""),
    ...(c.DIRECTORY_URL ? { DIRECTORY_URL: c.DIRECTORY_URL.replace(/\/+$/, "") } : {}),
    directoryProofUrl: c.DIRECTORY_PROOF_URL ?? (c.PUBLIC_DOMAIN === "localhost" ? `http://localhost:${c.PORT}/api/health` : `https://${c.PUBLIC_DOMAIN}/api/health`),
  };
}

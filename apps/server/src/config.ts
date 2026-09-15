import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_DOMAIN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  PROXY_MODE: z.enum(["bundled", "external"]).default("bundled"),
  TRUSTED_PROXIES: z.string().default("127.0.0.1"),
  /** Internal URL to the LiveKit server (server-to-server, e.g. RoomService). */
  LIVEKIT_URL: z.string().url(),
  /**
   * URL that clients receive for the media connection (without a path, the SDK appends /rtc).
   * Default: wss://PUBLIC_DOMAIN, i.e. through the proxy. In dev without a proxy: ws://localhost:7880.
   */
  LIVEKIT_PUBLIC_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(16),
  STATIC_DIR: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  /** Directory for attachments (Docker: volume). */
  DATA_DIR: z.string().default("./data"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  /**
   * Public key that becomes the owner on first sign-in. Empty = the first user
   * who signs in while no owner exists yet.
   */
  OWNER_PUBLIC_KEY: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Initial name of the server; changeable later in the settings. */
  SERVER_NAME: z.string().min(1).max(64).default("Community"),
  /**
   * Directory service (M6): public base URL, e.g. https://chat.example.org/id. At sign-in the server resolves
   * key -> handle and passes the URL on to clients (registration in the browser). Empty = no directory.
   */
  DIRECTORY_URL: z.string().url().optional(),
  /**
   * URL at which the directory reaches this server's /api/health (host proof during server registration).
   * Default: https://PUBLIC_DOMAIN/api/health; with PUBLIC_DOMAIN=localhost, http://localhost:PORT/api/health (dev).
   */
  DIRECTORY_PROOF_URL: z.string().url().optional(),
  /**
   * Pin "account required" at deployment time: true/false overrides the setting from the admin area (which is then
   * locked). Empty = the admin area decides. Only takes effect together with DIRECTORY_URL.
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

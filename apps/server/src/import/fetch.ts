import { DiscordTemplate } from "./discord";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 4 * 1024 * 1024;
const CACHE_MS = 60_000;

/** Why a template could not be fetched; the route turns these into 404 / 429 / 502. */
export class TemplateFetchError extends Error {
  constructor(readonly code: "unknown_template" | "discord_rate_limited" | "discord_unavailable", detail?: string) {
    super(detail ?? code);
  }
}

/**
 * Discord's public template endpoint (no token: checked 22 September 2026). A template is kept for a minute per code, so
 * the preview and the import that follows it read the same thing and a second try does not ask Discord again;
 * requests for the same code in flight share one fetch. Only successes are kept.
 */
export class DiscordTemplates {
  private readonly cache = new Map<string, { at: number; template: DiscordTemplate }>();
  private readonly inFlight = new Map<string, Promise<DiscordTemplate>>();

  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly base = "https://discord.com/api/v10/guilds/templates/") {}

  async get(code: string): Promise<DiscordTemplate> {
    const hit = this.cache.get(code);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.template;
    let p = this.inFlight.get(code);
    if (!p) {
      p = this.load(code).finally(() => this.inFlight.delete(code));
      this.inFlight.set(code, p);
    }
    const template = await p;
    this.cache.set(code, { at: Date.now(), template });
    return template;
  }

  private async load(code: string): Promise<DiscordTemplate> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${encodeURIComponent(code)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new TemplateFetchError("discord_unavailable", String(e));
    }
    if (res.status === 404) { await res.body?.cancel().catch(() => {}); throw new TemplateFetchError("unknown_template"); }
    if (res.status === 429) { await res.body?.cancel().catch(() => {}); throw new TemplateFetchError("discord_rate_limited"); }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new TemplateFetchError("discord_unavailable", `status ${res.status}`); }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) { await res.body?.cancel().catch(() => {}); throw new TemplateFetchError("discord_unavailable", "too large"); }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new TemplateFetchError("discord_unavailable", "too large");
    let json: unknown;
    try { json = JSON.parse(buf.toString("utf8")); } catch { throw new TemplateFetchError("discord_unavailable", "not json"); }
    const parsed = DiscordTemplate.safeParse(json);
    if (!parsed.success) throw new TemplateFetchError("discord_unavailable", "unexpected shape");
    return parsed.data;
  }
}

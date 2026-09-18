/**
 * Which addresses the client's windows may open or go to. Pure (tested); `security.ts` applies it.
 * `origins` = where the client itself lives: `app://squorli`, in development also the Vite server.
 */
const parse = (url: string): URL | null => { try { return new URL(url); } catch { return null; } };

/** Addresses handed to the system (its browser, its mail program). Nothing else ever reaches `shell.openExternal`. */
export function isAllowedExternal(url: string): boolean {
  const u = parse(url);
  return !!u && (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:");
}

const originOf = (u: URL): string => `${u.protocol}//${u.host}`;

/**
 * `window.open`: the client opens `about:blank` for a video pop-out (it fills the window itself) and its own
 * `/player-window.html` for the web radio's player. Web and mail addresses go to the system, everything else is refused.
 */
export function windowOpenDecision(url: string, origins: readonly string[]): "allow" | "external" | "deny" {
  if (url === "about:blank") return "allow";
  const u = parse(url);
  if (!u) return "deny";
  if (origins.includes(originOf(u))) return u.pathname === "/player-window.html" ? "allow" : "deny";
  return isAllowedExternal(url) ? "external" : "deny";
}

/** Navigation of a window's main frame: only inside the client. */
export function isAppNavigation(url: string, origins: readonly string[]): boolean {
  const u = parse(url);
  return !!u && origins.includes(originOf(u));
}

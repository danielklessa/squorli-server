import { InviteCode, ServerHost, directoryServerUrl } from "@squorli/protocol";

/**
 * Links that open the desktop app from a browser: `squorli://server/<host>` and `squorli://invite/<host>/<code>`.
 * DOM-free: the Electron main process bundles this file too (package export `./platform/deepLink`).
 *
 * The host is untrusted input. It must pass the protocol's `ServerHost` and is only ever turned into an address by
 * `directoryServerUrl()` (https, http for localhost only). A link never signs in by itself: the client shows the server
 * first and waits for a click (signing in reveals the public key and creates an account there).
 */
export type DeepLink = { kind: "server"; host: string } | { kind: "invite"; host: string; code: string };

export const DEEP_LINK_SCHEME = "squorli";

// Parsed on the raw string: `URL` does not parse the host of a non-special scheme the way it does for https.
const LINK = /^squorli:(?:\/\/)?(server|invite)\/([^/?#\s]+)(?:\/([^/?#\s]+))?\/?$/i;

export function parseDeepLink(raw: string): DeepLink | null {
  if (typeof raw !== "string" || raw.length > 400) return null;
  const m = LINK.exec(raw.trim());
  if (!m) return null;
  let hostRaw: string;
  try { hostRaw = decodeURIComponent(m[2]!); } catch { return null; }
  const host = ServerHost.safeParse(hostRaw);
  if (!host.success) return null;
  if (m[1]!.toLowerCase() === "server") return m[3] === undefined ? { kind: "server", host: host.data } : null;
  const code = InviteCode.safeParse(m[3]);
  return code.success ? { kind: "invite", host: host.data, code: code.data } : null;
}

export function formatDeepLink(link: DeepLink): string {
  return link.kind === "server" ? `${DEEP_LINK_SCHEME}://server/${link.host}` : `${DEEP_LINK_SCHEME}://invite/${link.host}/${link.code}`;
}

/** Address of the server a link names. */
export const deepLinkServerUrl = (link: DeepLink): string => directoryServerUrl(link.host);

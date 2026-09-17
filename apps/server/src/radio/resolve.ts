import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { firstPlaylistEntry, isHlsPlaylist, isPlaylistUrl } from "./playlist";

export type ResolveError = "unreachable" | "empty_playlist" | "forbidden_host";
export type ResolveResult = { ok: true; streamUrl: string } | { ok: false; error: ResolveError };

const TIMEOUT_MS = 5000;
const MAX_BYTES = 64 * 1024;
const MAX_HOPS = 4; // redirects and playlists that name another playlist, together

/** The server fetches an address a member typed in: never let that reach the host itself or its private network. */
const internal = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 3]] as const) internal.addSubnet(net, bits, "ipv4");
// No rule for ::ffff:0:0/96: Node's BlockList compares IPv4 and IPv4-mapped IPv6 addresses with each other, so such a rule
// would block every IPv4 address, and the IPv4 rules above already cover the mapped spelling (pinned by the test).
for (const [net, bits] of [["::", 127], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) internal.addSubnet(net, bits, "ipv6");

export function isInternalAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const a = mapped ? mapped[1]! : address;
  const family = isIP(a);
  if (family === 0) return true; // not an address at all
  return internal.check(a, family === 6 ? "ipv6" : "ipv4");
}

/** Every address of the host must be public; a name that does not resolve is simply unreachable. */
export async function checkHost(hostname: string): Promise<"public" | "internal" | "unknown"> {
  const host = hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addresses.length === 0) return "unknown";
    return addresses.every((a) => !isInternalAddress(a.address)) ? "public" : "internal";
  } catch { return "unknown"; }
}

/** Read at most MAX_BYTES of a body as text; a playlist is a few lines, anything longer is not one. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8");
}

/**
 * What clients should play for a station's address. A plain stream address is returned as it is (no request at all);
 * a playlist is fetched (public hosts only, short timeout, small body) and its first entry taken.
 */
export async function resolveStreamUrl(stationUrl: string): Promise<ResolveResult> {
  let url = stationUrl;
  let playlist = isPlaylistUrl(url);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!playlist) return { ok: true, streamUrl: url };
    const host = await checkHost(new URL(url).hostname);
    if (host !== "public") return { ok: false, error: host === "internal" ? "forbidden_host" : "unreachable" };
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Squorli", accept: "*/*" } });
    } catch { return { ok: false, error: "unreachable" }; }
    const discard = () => res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      await discard();
      // Still the playlist, whatever the new address is called: every hop is checked again as above.
      try { url = new URL(res.headers.get("location") ?? "", url).href; } catch { return { ok: false, error: "unreachable" }; }
      if (!/^https?:$/.test(new URL(url).protocol)) return { ok: false, error: "unreachable" };
      continue;
    }
    if (!res.ok) { await discard(); return { ok: false, error: "unreachable" }; }
    // Some stations serve the audio itself under a playlist name.
    if (/^audio\/(?!x-mpegurl|mpegurl|x-scpls)/i.test(res.headers.get("content-type") ?? "")) { await discard(); return { ok: true, streamUrl: url }; }
    let text: string;
    try { text = await readCapped(res); } catch { return { ok: false, error: "unreachable" }; }
    if (isHlsPlaylist(text)) return { ok: true, streamUrl: url };
    const entry = firstPlaylistEntry(text, url);
    if (!entry) return { ok: false, error: "empty_playlist" };
    url = entry;
    playlist = isPlaylistUrl(url);
  }
  return playlist ? { ok: false, error: "unreachable" } : { ok: true, streamUrl: url };
}

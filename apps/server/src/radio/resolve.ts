import { checkHost, isInternalAddress, publicLookup } from "@squorli/link-preview";
import { twitchChannelOf, youtubeVideoOf } from "@squorli/protocol";
import { firstPlaylistEntry, isHlsPlaylist, isPlaylistUrl } from "./playlist";

export type ResolveError = "unreachable" | "empty_playlist" | "forbidden_host";
export type ResolveResult = { ok: true; streamUrl: string } | { ok: false; error: ResolveError };

const TIMEOUT_MS = 5000;
const MAX_BYTES = 64 * 1024;
const MAX_HOPS = 4; // redirects and playlists that name another playlist, together

// The address rules (which hosts a fetch on behalf of a member may reach) are shared with the link previews.
export { checkHost, isInternalAddress, publicLookup };

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
  // A Twitch channel page is not played as audio: clients show Twitch's player for it. One spelling, no request.
  const twitch = twitchChannelOf(stationUrl);
  if (twitch) return { ok: true, streamUrl: `https://www.twitch.tv/${twitch}` };
  // The same for a YouTube video (the start offset of the address becomes the playback state, routes/radio.ts).
  const youtube = youtubeVideoOf(stationUrl);
  if (youtube) return { ok: true, streamUrl: `https://www.youtube.com/watch?v=${youtube.videoId}` };
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

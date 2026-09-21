export type YoutubeLookup = { ok: true; title: string | null } | { ok: false; error: "unknown_video" | "not_embeddable" };

const TIMEOUT_MS = 4000;

/** What YouTube's oEmbed answer means for us. 401/403 = the owner does not allow embedding (or the video is private). */
export function readOembed(status: number, body: unknown): YoutubeLookup {
  if (status === 401 || status === 403) return { ok: false, error: "not_embeddable" };
  if (status === 400 || status === 404) return { ok: false, error: "unknown_video" };
  const title = status === 200 && body && typeof body === "object" ? (body as { title?: unknown }).title : null;
  return { ok: true, title: typeof title === "string" && title.trim() ? title.trim().slice(0, 100) : null };
}

/**
 * A video's title, asked from YouTube's public oEmbed endpoint (a fixed address of youtube.com, nothing a user typed is
 * fetched): when a member starts the video as a radio source, and for the preview of a YouTube link. It also tells a video
 * that does not exist or may not be embedded, which would otherwise only show as an error inside everyone's player.
 * YouTube not reachable from here is no reason to refuse: the players talk to YouTube themselves, there is simply no title.
 */
export async function lookupYoutube(videoId: string, fetcher: typeof fetch = fetch): Promise<YoutubeLookup> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Squorli", accept: "application/json" } });
    const body: unknown = res.status === 200 ? await res.json().catch(() => null) : (await res.body?.cancel().catch(() => {}), null);
    return readOembed(res.status, body);
  } catch { return { ok: true, title: null }; }
}

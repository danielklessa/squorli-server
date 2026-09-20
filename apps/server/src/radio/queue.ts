import type { YoutubeLookup } from "./youtube";

/**
 * The queue of a channel's radio: the videos of a YouTube playlist, played one after the other for everyone. The ids come
 * from the client of the member who started it (the server has no API key to read a playlist with; docs/features/radio.md),
 * the server keeps them and decides which video is on. Stored on the channel (`channels.radio_queue`).
 */
export type StoredRadioQueue = { listId: string; videoIds: string[]; index: number };

/** How many entries in a row may turn out unplayable (deleted, private, embedding forbidden) before giving up. */
const MAX_SKIPS = 10;

/**
 * The next entry that can be played, starting at `start` and going on in direction `step`, around the ends (a radio does
 * not stop at the end of its list). `lookup` = YouTube's oEmbed (youtube.ts): it names the video and tells the ones no
 * player would show. null = nothing playable within MAX_SKIPS entries.
 */
export async function pickPlayable(videoIds: readonly string[], start: number, step: 1 | -1, lookup: (videoId: string) => Promise<YoutubeLookup>): Promise<{ index: number; title: string | null } | null> {
  const n = videoIds.length;
  if (n === 0) return null;
  for (let tries = 0; tries < Math.min(n, MAX_SKIPS); tries++) {
    const index = (((start + tries * step) % n) + n) % n;
    const video = await lookup(videoIds[index]!);
    if (video.ok) return { index, title: video.title };
  }
  return null;
}

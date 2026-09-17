/**
 * Web radio playlists, pure part: a station's address is either the audio stream itself or a playlist that names it
 * (.m3u, .m3u8, .pls). Browsers cannot play those (and may not fetch them across origins), so the server reads them
 * when the radio is started (resolve.ts) and hands clients the stream address.
 */

/** Decided by the path's extension only: a plain stream address is never fetched by the server. */
export function isPlaylistUrl(url: string): boolean {
  try { return /\.(m3u8?|pls)$/i.test(new URL(url).pathname); } catch { return false; }
}

/**
 * HLS also uses .m3u8, but its entries are media segments, not a stream: there the playlist address itself is what a
 * player needs (Safari and newer Chromium play it natively, other browsers report an error in the radio menu).
 */
export function isHlsPlaylist(text: string): boolean {
  return /^#EXT-X-/m.test(text);
}

/** First http(s) address of an M3U ("#" lines are comments) or PLS ("File1=...") playlist, resolved against `base`; null = none. */
export function firstPlaylistEntry(text: string, base: string): string | null {
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("[")) continue;
    const pls = /^File\d+\s*=\s*(.+)$/i.exec(line);
    if (!pls && /^[A-Za-z]+\d*\s*=/.test(line)) continue; // other PLS keys (Title1=, Length1=, NumberOfEntries=, Version=)
    try {
      const u = new URL(pls ? pls[1]!.trim() : line, base);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch { /* not an address: next line */ }
  }
  return null;
}

import { DM_BLOB_MAX_BYTES, DM_MAX_PREVIEWS, previewLinks, sealDmBlob, youtubeVideoOf, type DmBlobRef, type DmControl, type DmPreview } from "@squorli/protocol";

/**
 * Link previews in direct messages (docs/features/link-previews.md). Direct messages are end-to-end encrypted, so the
 * SENDER makes the preview and puts it into the message: whoever reads it contacts nobody, and no server learns what the
 * preview says. The lookup is done by whoever can (`Lookup`: the desktop app asks the linked host itself, a browser asks
 * the directory); the picture is made small here, encrypted with a key of its own and stored in the directory's blob store
 * (`putBlob`), and only blob id, key and IV go into the message. This file holds the parts that need no browser and are
 * tested; the picture work (canvas) is in dmPreviewImage.ts.
 */
export type LookupRequest = { url: string } | { youtube: string };
export type LookupResult = { kind: "page" | "youtube"; siteName: string | null; title: string | null; description: string | null; image: { mime: string; bytes: Uint8Array } | null };
export type PreviewDeps = {
  lookUp: (request: LookupRequest) => Promise<LookupResult | null>;
  /** Make the picture small; null = it cannot be shown (not a picture after all). */
  shrink: (image: { mime: string; bytes: Uint8Array }) => Promise<{ mime: DmBlobRef["mime"]; bytes: Uint8Array } | null>;
  /** Store ciphertext, get the blob's id; null = there is no blob store (an older directory): the preview goes without a picture. */
  putBlob: ((ciphertext: Uint8Array) => Promise<string>) | null;
};

/** Longer than this and the message goes out without previews: sending must never hang on a slow website. */
export const PREVIEW_DEADLINE_MS = 8000;

async function buildOne(url: string, deps: PreviewDeps): Promise<DmPreview | null> {
  const video = youtubeVideoOf(url);
  const found = await deps.lookUp(video ? { youtube: video.videoId } : { url });
  if (!found) return null;
  let image: DmBlobRef | null = null;
  if (found.image && deps.putBlob) {
    try {
      const small = await deps.shrink(found.image);
      if (small) {
        const sealed = await sealDmBlob(small.bytes);
        if (sealed.ciphertext.length <= DM_BLOB_MAX_BYTES) image = { blob: await deps.putBlob(sealed.ciphertext), key: sealed.key, iv: sealed.iv, mime: small.mime };
      }
    } catch { image = null; } // a preview without its picture is still a preview
  }
  if (!found.title && !image) return null;
  return { url, kind: found.kind, siteName: found.siteName, title: found.title, description: found.description, image, ...(video ? { videoId: video.videoId, ...(video.start > 0 ? { start: video.start } : {}) } : {}) };
}

/** The previews for a text about to be sent, in the order of its links. Never throws and never takes longer than the deadline. */
export async function buildDmPreviews(text: string, deps: PreviewDeps, deadlineMs = PREVIEW_DEADLINE_MS): Promise<DmPreview[]> {
  const links = previewLinks(text).slice(0, DM_MAX_PREVIEWS);
  if (links.length === 0) return [];
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), deadlineMs));
  const found = await Promise.all(links.map((url) => Promise.race([buildOne(url, deps).catch(() => null), late])));
  return found.filter((p): p is DmPreview => p !== null);
}

/** What a conversation needs to know of a message for this: who wrote it, its previews, and whether it is an instruction. */
export type PreviewCarrier = { id: string; from: string; previews?: DmPreview[] | undefined; control?: DmControl | undefined };

/**
 * What a conversation shows: instructions (`control`) are no messages, and a preview is gone once ITS AUTHOR said so. An
 * instruction from the other side about my message changes nothing: only whoever sent a link may take its preview away.
 */
export function visibleDms<T extends PreviewCarrier>(list: readonly T[]): (T & { shown: DmPreview[] })[] {
  const authorOf = new Map(list.map((m) => [m.id, m.from]));
  const removed = new Set<string>();
  for (const m of list) if (m.control?.type === "preview.remove" && authorOf.get(m.control.id) === m.from) removed.add(`${m.control.id}\n${m.control.url}`);
  return list.filter((m) => !m.control).map((m) => ({ ...m, shown: (m.previews ?? []).filter((p) => !removed.has(`${m.id}\n${p.url}`)) }));
}

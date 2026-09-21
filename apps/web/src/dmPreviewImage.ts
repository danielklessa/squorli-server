import { DM_BLOB_MAX_BYTES, openDmBlob, type DmBlobRef } from "@squorli/protocol";
import { useEffect, useState } from "react";

/**
 * The picture of a link preview in a direct message, the parts that need a browser (dmPreviews.ts has the rest).
 * Sending: whatever the linked host delivered is drawn small onto a canvas and encoded again, so what goes into the blob
 * store is a plain picture of known size and type (nothing of the original file survives: no metadata, no animation, no
 * oversized image). Reading: fetch the ciphertext from the directory, decrypt it with the key from the message, show it
 * through an object URL; a blob that is gone or does not open is simply no picture.
 */
const MAX_WIDTH = 640;
const MAX_HEIGHT = 480;
// Encrypting adds 16 bytes; leave the store's limit some air.
const TARGET_BYTES = DM_BLOB_MAX_BYTES - 1024;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function shrinkPreviewImage(image: { mime: string; bytes: Uint8Array }): Promise<{ mime: DmBlobRef["mime"]; bytes: Uint8Array } | null> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.mime })); } catch { return null; }
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const [type, quality] of [["image/webp", 0.82], ["image/webp", 0.6], ["image/jpeg", 0.6]] as const) {
      const blob = await toBlob(canvas, type, quality);
      // A browser that cannot encode the type answers with PNG: then try the next.
      if (blob && blob.type === type && blob.size <= TARGET_BYTES) return { mime: type, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
    return null;
  } finally { bitmap.close(); }
}

/** One object URL per blob for as long as the page lives: a conversation is scrolled through many times. */
const urls = new Map<string, Promise<string | null>>();
function loadBlobUrl(ref: DmBlobRef, fetchBlob: (id: string) => Promise<Uint8Array>): Promise<string | null> {
  let p = urls.get(ref.blob);
  if (!p) {
    p = fetchBlob(ref.blob).then((ciphertext) => openDmBlob(ref, ciphertext)).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: ref.mime })))
      .catch(() => { urls.delete(ref.blob); return null; });
    urls.set(ref.blob, p);
  }
  return p;
}

/** "pending" while it loads (the card keeps the picture's place), null = there is none (any more). */
export function useDmBlobUrl(ref: DmBlobRef | null, fetchBlob: (id: string) => Promise<Uint8Array>): string | null | "pending" {
  const [url, setUrl] = useState<string | null | "pending">(ref ? "pending" : null);
  useEffect(() => {
    if (!ref) { setUrl(null); return; }
    let stale = false;
    setUrl("pending");
    void loadBlobUrl(ref, fetchBlob).then((u) => { if (!stale) setUrl(u); });
    return () => { stale = true; };
  }, [ref?.blob, ref?.key, ref?.iv, fetchBlob]);
  return url;
}

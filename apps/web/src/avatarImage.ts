import { AVATAR_MAX_BYTES, AVATAR_SIZE, AvatarMime } from "@squorli/protocol";

export type AvatarImage = { mime: AvatarMime; bytes: Uint8Array };
/** The file could not be decoded as an image (`unreadable`) or stays above the directory's limit after scaling (`too_large`). */
export class AvatarImageError extends Error {
  constructor(readonly reason: "unreadable" | "too_large") { super(reason); this.name = "AvatarImageError"; }
}

/** Side and offset of the centered square of an image (pure, tested). */
export function centeredSquare(width: number, height: number): { side: number; x: number; y: number } {
  const side = Math.min(width, height);
  return { side, x: (width - side) / 2, y: (height - side) / 2 };
}

/**
 * Turn whatever image the browser can decode into the avatar the directory takes: the centered square, scaled to AVATAR_SIZE,
 * encoded as WebP (PNG where the browser cannot encode WebP, JPEG on a white ground if that PNG is too large). The directory has
 * no image library, so the clients normalize; re-encoding also drops metadata such as the location of a photo. The same steps
 * as `prepareAvatar` on the directory's account page (`../squorli-directory/apps/directory/web/main.ts`): change both together.
 */
export async function prepareAvatar(file: Blob): Promise<AvatarImage> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new AvatarImageError("unreadable"); }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AvatarImageError("unreadable");
    const { side, x, y } = centeredSquare(bmp.width, bmp.height);
    const draw = () => ctx.drawImage(bmp, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const encode = (type: AvatarMime, quality?: number) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
    ctx.imageSmoothingQuality = "high";
    draw();
    let blob = await encode("image/webp", 0.9);
    if (!blob || blob.type !== "image/webp") blob = await encode("image/png");
    if (!blob || blob.size > AVATAR_MAX_BYTES) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
      draw();
      blob = await encode("image/jpeg", 0.85);
    }
    const mime = AvatarMime.safeParse(blob?.type);
    if (!blob || !mime.success || blob.size > AVATAR_MAX_BYTES) throw new AvatarImageError("too_large");
    return { mime: mime.data, bytes: new Uint8Array(await blob.arrayBuffer()) };
  } finally { bmp.close(); }
}

/** Bytes as base64 (in chunks: `String.fromCharCode(...bytes)` overflows the stack for large arrays). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

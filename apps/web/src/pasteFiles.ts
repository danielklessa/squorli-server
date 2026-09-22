/**
 * Files from a paste into the channel chat (Ctrl+V, or "Einfügen" in the desktop app's context menu; user's wish, 23
 * September 2026): a picture copied from a screenshot tool or a web page, or files copied in the file manager. The composer
 * takes them like files chosen with the paper clip (ChatView.tsx). Pure and tested; the browser hands the clipboard's
 * contents in as a `DataTransfer`.
 */

/** File name extensions for the picture types a clipboard carries; anything else keeps the name the browser gave. */
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };

const two = (n: number) => String(n).padStart(2, "0");

/** A clipboard picture is called "image.png" everywhere; a name with the time tells two pasted pictures apart. */
export function pastedImageName(type: string, now: Date): string {
  const ext = EXTENSIONS[type] ?? "png";
  return `image-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}.${ext}`;
}

const isGenericName = (name: string): boolean => name === "" || /^image\.[a-z0-9]+$/i.test(name);

/** The files of a paste (none for plain text), clipboard pictures renamed with the time. */
export function pastedFiles(data: Pick<DataTransfer, "items" | "files"> | null | undefined, now: Date = new Date()): File[] {
  if (!data) return [];
  const found: File[] = [];
  const items = data.items ? Array.from(data.items) : [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) found.push(file);
    }
  } else if (data.files) found.push(...Array.from(data.files));
  return found.map((file) => (file.type.startsWith("image/") && isGenericName(file.name) ? new File([file], pastedImageName(file.type, now), { type: file.type, lastModified: file.lastModified }) : file));
}

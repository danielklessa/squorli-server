import { app, nativeImage, type NativeImage } from "electron";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { steamIconFile } from "./launchers";

/**
 * Icons for the list of installed games in the settings, from this computer alone (docs/features/games.md): asking the
 * directory's library for every installed game would hand it the list of a user's games, and the settings promise that only
 * the running game is sent. A source is a picture the launcher put there, an executable whose icon Windows knows, or Steam's
 * cache folder of an app (launchers.ts names them, best first). Whatever is read goes through Electron's image decoder and
 * leaves as a small PNG, so the client never gets a file's bytes as they are.
 */
const ICON_PX = 32;
const MAX_FILE_BYTES = 1024 * 1024;
const SOURCE_TIMEOUT_MS = 3000;

const asDataUrl = (image: NativeImage): string | null => {
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const small = width > ICON_PX || height > ICON_PX ? image.resize({ width: ICON_PX, height: ICON_PX, quality: "best" }) : image;
  return small.isEmpty() ? null : small.toDataURL();
};

async function pictureFile(file: string): Promise<string | null> {
  if ((await stat(file)).size > MAX_FILE_BYTES) return null;
  return asDataUrl(nativeImage.createFromBuffer(await readFile(file)));
}

async function fromSource(source: string): Promise<string | null> {
  if (source.endsWith("\\")) {
    const name = steamIconFile(await readdir(source));
    return name ? pictureFile(join(source, name)) : null;
  }
  // Windows' icon of the file: an executable's own, and for an .ico (which the decoder does not read from a buffer) the icon
  // itself. Asked only for a file that exists, or Windows answers with its blank sheet.
  if (/\.(exe|ico)$/i.test(source)) { await stat(source); return asDataUrl(await app.getFileIcon(source, { size: "normal" })); }
  return pictureFile(source);
}

/** A source that hangs (a drive that does not answer) or does not exist gives none. */
const limited = (source: string): Promise<string | null> => Promise.race([fromSource(source).catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), SOURCE_TIMEOUT_MS))]);

/** Icons by game id as data URLs; an icon found once is kept for the session, one not found is looked for again next time. */
export class GameIcons {
  private readonly found = new Map<string, string>();

  async of(sources: ReadonlyMap<string, readonly string[]>): Promise<Map<string, string>> {
    await Promise.all([...sources].map(async ([id, candidates]) => {
      if (this.found.has(id)) return;
      for (const source of candidates) {
        const icon = await limited(source);
        if (icon) { this.found.set(id, icon); return; }
      }
    }));
    return new Map([...sources.keys()].flatMap((id) => { const icon = this.found.get(id); return icon ? [[id, icon] as const] : []; }));
  }
}

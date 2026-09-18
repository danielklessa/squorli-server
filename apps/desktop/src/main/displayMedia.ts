import { desktopCapturer, ipcMain, webContents, type IpcMainEvent, type Session } from "electron";
import { IPC, type ScreenPick, type ScreenPickRequest, type ScreenSource } from "@squorli/web/platform/bridge";

/**
 * Screen share: Electron has no picker of its own, so the client shows one (ScreenPicker.tsx). `getDisplayMedia()` in the page
 * lands here, the shell lists screens and windows, the page answers with the choice. System audio ("loopback") exists on
 * Windows only (PLAN 3.6).
 */
const PICK_TIMEOUT_MS = 120_000;

export function handleDisplayMedia(ses: Session, isClientFrame: (event: IpcMainEvent) => boolean): void {
  let nextId = 1;
  const waiting = new Map<number, (pick: ScreenPick | null) => void>();
  ipcMain.on(IPC.screenPickAnswer, (event, requestId: unknown, pick: unknown) => {
    if (!isClientFrame(event) || typeof requestId !== "number") return;
    const p = pick as Partial<ScreenPick> | null;
    waiting.get(requestId)?.(p && typeof p.sourceId === "string" ? { sourceId: p.sourceId, audio: p.audio === true } : null);
  });

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const contents = request.frame ? webContents.fromFrame(request.frame) : undefined;
    // Refusing = an empty answer; the page sees the same error as after "cancel" in a browser's picker.
    const refuse = () => { try { callback({}); } catch { /* Electron throws on an empty answer in some versions; the request is refused either way */ } };
    if (!contents) { refuse(); return; }
    try {
      const canShareAudio = process.platform === "win32" && request.audioRequested;
      const found = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      const sources: ScreenSource[] = found.map((s) => ({
        id: s.id, kind: s.id.startsWith("screen:") ? "screen" : "window", name: s.name,
        thumbnail: s.thumbnail.isEmpty() ? "" : `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString("base64")}`,
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
      const requestId = nextId++;
      const pick = await new Promise<ScreenPick | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), PICK_TIMEOUT_MS);
        waiting.set(requestId, (p) => { clearTimeout(timer); resolve(p); });
        contents.send(IPC.screenPickRequest, { requestId, sources, canShareAudio } satisfies ScreenPickRequest);
      });
      waiting.delete(requestId);
      const source = pick ? found.find((s) => s.id === pick.sourceId) : undefined;
      if (!pick || !source) { refuse(); return; }
      callback({ video: source, ...(pick.audio && canShareAudio ? { audio: "loopback" as const } : {}) });
    } catch { refuse(); }
  }, { useSystemPicker: false });
}

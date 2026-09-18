import { BrowserWindow, desktopCapturer, ipcMain, webContents, type IpcMainEvent, type Session } from "electron";
import { IPC, type ScreenPick, type ScreenPickRequest, type ScreenSource } from "@squorli/web/platform/bridge";
import { hwndOfHandle, hwndOfSource } from "./captureSource";
import { helperPath, type ScreenAudioCapture } from "./windowAudio";

/**
 * Screen share: Electron has no picker of its own, so the client shows one (ScreenPicker.tsx). `getDisplayMedia()` in the page
 * lands here, the shell lists screens and windows, the page answers with the choice.
 *
 * Audio (Windows only, PLAN 3.6): with the native helper (windowAudio.ts) a window carries what its application plays and a
 * screen what the system plays without this app; the helper's PCM goes to the client separately and Chromium gets no audio
 * to capture. Without the helper only a screen has audio: Chromium's "loopback" (everything, the app included). The app's
 * own windows never carry audio: it would be the voices of the others.
 */
const PICK_TIMEOUT_MS = 120_000;

export function handleDisplayMedia(ses: Session, isClientFrame: (event: IpcMainEvent) => boolean, capture: ScreenAudioCapture): void {
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
      const windows = process.platform === "win32";
      const native = helperPath() !== null;
      const own = new Set(BrowserWindow.getAllWindows().map((w) => hwndOfHandle(w.getNativeWindowHandle())));
      const audioFor = (id: string): boolean => {
        if (!windows || !request.audioRequested) return false;
        const hwnd = hwndOfSource(id);
        return hwnd === null ? true : native && !own.has(hwnd);
      };
      const found = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      const sources: ScreenSource[] = found.map((s) => ({
        id: s.id, kind: s.id.startsWith("screen:") ? "screen" : "window", name: s.name,
        thumbnail: s.thumbnail.isEmpty() ? "" : `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString("base64")}`,
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        audio: audioFor(s.id),
      }));
      const requestId = nextId++;
      const pick = await new Promise<ScreenPick | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), PICK_TIMEOUT_MS);
        waiting.set(requestId, (p) => { clearTimeout(timer); resolve(p); });
        contents.send(IPC.screenPickRequest, { requestId, sources } satisfies ScreenPickRequest);
      });
      waiting.delete(requestId);
      const source = pick ? found.find((s) => s.id === pick.sourceId) : undefined;
      if (!pick || !source) { refuse(); return; }
      const withAudio = pick.audio && audioFor(source.id);
      if (withAudio && native) {
        // The helper's audio reaches the client on its own channel; a helper that does not start leaves the share without audio.
        const hwnd = hwndOfSource(source.id);
        void capture.start(hwnd !== null ? { kind: "window", hwnd } : { kind: "system" }, contents);
        callback({ video: source });
      } else callback({ video: source, ...(withAudio ? { audio: "loopback" as const } : {}) });
    } catch { refuse(); }
  }, { useSystemPicker: false });
}

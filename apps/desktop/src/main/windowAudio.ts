import { app, type WebContents } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { IPC, type ScreenAudioEvent } from "@squorli/web/platform/bridge";

/**
 * Audio of a screen share, captured by the native helper `squorli-window-audio.exe` (apps/desktop/native, Windows 10 2004+):
 * what ONE window's application plays, or everything the system plays EXCEPT this app. Electron itself only knows the
 * whole system's audio, which carries the voices of the others back to them. The helper writes PCM to stdout; it goes to
 * the client in chunks (`screenAudio` channel), which publishes it as the share's audio track.
 *
 * The helper is optional: without it (not built, other platform) `helperPath()` is null and a share offers the system's
 * audio through Chromium as before.
 */
export type CaptureTarget = { kind: "window"; hwnd: string } | { kind: "system" };

export function helperPath(): string | null {
  if (process.platform !== "win32") return null;
  const file = app.isPackaged ? join(process.resourcesPath, "native", "squorli-window-audio.exe") : join(__dirname, "..", "native", "bin", "win32-x64", "squorli-window-audio.exe");
  return existsSync(file) ? file : null;
}

// 20 ms of 48 kHz stereo 16 bit: small enough for low delay, large enough not to flood the channel.
const CHUNK_BYTES = 3840;

export class ScreenAudioCapture {
  private child: ChildProcess | null = null;

  /** Start capturing for `contents`; resolves true once the helper reports "ready". A running capture is replaced. */
  start(target: CaptureTarget, contents: WebContents): Promise<boolean> {
    this.stop();
    const helper = helperPath();
    if (!helper) return Promise.resolve(false);
    const args = target.kind === "window" ? ["--include-hwnd", target.hwnd] : ["--exclude-pid", String(process.pid)];
    const child = spawn(helper, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    const send = (event: ScreenAudioEvent) => { if (!contents.isDestroyed()) contents.send(IPC.screenAudio, event); };

    let pending: Buffer[] = [], pendingBytes = 0;
    child.stdout?.on("data", (data: Buffer) => {
      pending.push(data); pendingBytes += data.length;
      if (pendingBytes < CHUNK_BYTES) return;
      const all = Buffer.concat(pending, pendingBytes);
      const whole = all.length - (all.length % 4);
      send({ type: "data", pcm: new Uint8Array(all.buffer, all.byteOffset, whole).slice() });
      pending = whole < all.length ? [all.subarray(whole)] : []; pendingBytes = all.length - whole;
    });

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      let log = "";
      child.stderr?.on("data", (data: Buffer) => {
        log += data.toString("utf8");
        if (log.includes("ready")) { send({ type: "start" }); settle(true); }
      });
      child.on("error", () => settle(false));
      child.on("exit", () => {
        if (this.child === child) this.child = null;
        if (!settled && log) console.warn(`window audio helper: ${log.trim()}`);
        send({ type: "end" });
        settle(false);
      });
      setTimeout(() => { if (!settled) { this.stop(); settle(false); } }, 5000);
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    // Closing stdin is the helper's signal to end; the kill is the safety net.
    child.stdin?.end();
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 500);
  }
}

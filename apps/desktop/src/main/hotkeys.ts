import { globalShortcut, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { IPC, type ControlAction, type ControlEvent, type HotkeyAction, type HotkeyRequest, type HotkeyState, type HotkeyStatus, type PttWatchState } from "@squorli/web/platform/bridge";
import { HOTKEY_ACTIONS, NO_HOTKEYS, hotkeyAccelerator, normalizeHotkeys } from "@squorli/web/platform/hotkeys";
import { scanCodeOf } from "./keyCodes";
import type { SystemWatch } from "./systemWatch";

/**
 * Global shortcuts and control from outside the window (docs/features/hotkeys.md, 22 September 2026). The client sends
 * its bindings (`IPC.hotkeysSet`); each becomes one of Electron's global shortcuts, which the system delivers whichever
 * window has the focus and keeps from every other program. Push-to-talk needs the key's release too, which a shortcut
 * never reports, so the push-to-talk key goes to the system watch helper (`SystemWatch.setKeys`), which watches that one
 * key with Raw Input and takes it from nobody. Every command reaches the client as a `ControlEvent` on `IPC.control`; the
 * links and arguments of a second start arrive through `control()` (index.ts). While the client captures a new key
 * (`IPC.hotkeysSuspend`) nothing is registered or watched: a registered shortcut would never reach the window.
 */
export type Hotkeys = { control(action: ControlAction): void; stop(): void };

export function handleHotkeys(getWindow: () => BrowserWindow | null, isClientFrame: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean, systemWatch: SystemWatch, log: (text: string) => void = () => {}): Hotkeys {
  let request: HotkeyRequest = { bindings: { ...NO_HOTKEYS }, pttKey: null };
  let suspended = false;
  let pttScan: number | null = null;
  let pttDown = false;
  const send = (event: ControlEvent) => { const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send(IPC.control, event); };
  const releasePtt = () => { if (pttDown) { pttDown = false; send({ kind: "ptt", down: false }); } };

  const apply = (): HotkeyStatus => {
    globalShortcut.unregisterAll();
    const status = { micToggle: "off", deafenToggle: "off", ptt: "off" } as HotkeyStatus;
    const actions: Record<HotkeyAction, ControlAction> = { micToggle: "mic-toggle", deafenToggle: "deafen-toggle" };
    for (const action of HOTKEY_ACTIONS) {
      const binding = request.bindings[action];
      if (!binding) continue;
      const accelerator = hotkeyAccelerator(binding);
      let state: HotkeyState = accelerator ? "ok" : "invalid";
      if (accelerator && !suspended) {
        try { if (!globalShortcut.register(accelerator, () => send({ kind: "action", action: actions[action], source: "hotkey" }))) state = "taken"; } catch { state = "invalid"; }
        log(`hotkey ${action} ${accelerator}: ${state}`);
      }
      status[action] = state;
    }
    // The push-to-talk key: watched only while the client asks for it (in a channel, push-to-talk chosen) and not suspended.
    let ptt: PttWatchState = "off";
    let scan: number | null = null;
    if (request.pttKey !== null) {
      if (!systemWatch.available()) ptt = "unsupported";
      else { scan = scanCodeOf(request.pttKey); ptt = scan === null ? "invalid" : "ok"; }
    }
    const wanted = suspended ? null : scan;
    if (wanted !== pttScan) { pttScan = wanted; releasePtt(); systemWatch.setKeys(wanted === null ? [] : [wanted]); }
    status.ptt = ptt;
    return status;
  };

  systemWatch.onKey((event) => {
    if (event === null) { releasePtt(); return; }
    if (event.scan !== pttScan) return;
    if (event.down === pttDown) return;
    pttDown = event.down;
    send({ kind: "ptt", down: event.down });
  });

  ipcMain.handle(IPC.hotkeysSet, (event, next: unknown) => {
    if (!isClientFrame(event)) return apply();
    const v = next && typeof next === "object" ? next as Record<string, unknown> : {};
    request = { bindings: normalizeHotkeys(v.bindings), pttKey: typeof v.pttKey === "string" && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(v.pttKey) ? v.pttKey : null };
    return apply();
  });
  ipcMain.on(IPC.hotkeysSuspend, (event, on: unknown) => { if (!isClientFrame(event)) return; suspended = on === true; apply(); });

  return {
    control: (action) => { log(`control from outside: ${action}`); send({ kind: "action", action, source: "external" }); },
    stop: () => { globalShortcut.unregisterAll(); },
  };
}

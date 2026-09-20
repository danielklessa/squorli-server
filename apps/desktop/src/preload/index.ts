import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { BRIDGE_GLOBAL, INFO_ARGUMENT, IPC, type DesktopBridge, type DesktopInfo, type AppearanceState, type ScreenAudioEvent, type ScreenPick, type ScreenPickRequest, type UpdateState, type WindowAppearance, type WindowControl, type WindowFrameState } from "@squorli/web/platform/bridge";

/**
 * Preload script (sandboxed, context-isolated): the only thing the page gets from the shell is this bridge. Plain data in
 * both directions; the page never sees `ipcRenderer` or an event object.
 */
const raw = process.argv.find((a) => a.startsWith(INFO_ARGUMENT))?.slice(INFO_ARGUMENT.length) ?? "";
const info = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as DesktopInfo;

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

const bridge: DesktopBridge = {
  info,
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  onDeepLink: (cb) => { const off = subscribe<string>(IPC.deepLink, cb); ipcRenderer.send(IPC.deepLinkReady); return off; },
  onScreenPickRequest: (cb) => subscribe<ScreenPickRequest>(IPC.screenPickRequest, cb),
  answerScreenPick: (requestId: number, pick: ScreenPick | null) => ipcRenderer.send(IPC.screenPickAnswer, requestId, pick),
  onScreenAudio: (cb) => subscribe<ScreenAudioEvent>(IPC.screenAudio, cb),
  stopScreenAudio: () => ipcRenderer.send(IPC.screenAudioStop),
  setPlayerOutput: (label: string | null) => ipcRenderer.send(IPC.playerOutput, label),
  setAppearance: (appearance: WindowAppearance) => ipcRenderer.invoke(IPC.setAppearance, appearance) as Promise<AppearanceState>,
  relaunch: () => ipcRenderer.send(IPC.relaunch),
  windowControl: (action: WindowControl) => ipcRenderer.send(IPC.windowControl, action),
  setCloseToTray: (on: boolean) => ipcRenderer.invoke(IPC.setCloseToTray, on) as Promise<boolean>,
  setAutostart: (on: boolean) => ipcRenderer.invoke(IPC.setAutostart, on) as Promise<boolean>,
  setAutostartBackground: (on: boolean) => ipcRenderer.invoke(IPC.setAutostartBackground, on) as Promise<boolean>,
  setAttention: (count: number) => ipcRenderer.send(IPC.attention, count),
  onWindowFrame: (cb) => subscribe<WindowFrameState>(IPC.windowFrame, cb),
  onUpdateState: (cb) => subscribe<UpdateState>(IPC.updateState, cb),
  checkForUpdates: () => ipcRenderer.send(IPC.updateCheck),
  restartAndInstall: () => ipcRenderer.send(IPC.updateInstall),
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, bridge);

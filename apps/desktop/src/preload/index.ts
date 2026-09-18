import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { BRIDGE_GLOBAL, INFO_ARGUMENT, IPC, type DesktopBridge, type DesktopInfo, type ScreenPick, type ScreenPickRequest, type UpdateState, type WindowAppearance } from "@squorli/web/platform/bridge";

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
  setAppearance: (appearance: WindowAppearance) => ipcRenderer.invoke(IPC.setAppearance, appearance) as Promise<WindowAppearance>,
  onUpdateState: (cb) => subscribe<UpdateState>(IPC.updateState, cb),
  checkForUpdates: () => ipcRenderer.send(IPC.updateCheck),
  restartAndInstall: () => ipcRenderer.send(IPC.updateInstall),
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, bridge);

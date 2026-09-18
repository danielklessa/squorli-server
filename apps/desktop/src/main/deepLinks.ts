import { app, ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import { IPC } from "@squorli/web/platform/bridge";
import { DEEP_LINK_SCHEME, parseDeepLink } from "@squorli/web/platform/deepLink";
import { findDeepLink } from "./deepLinkArgs";

/**
 * `squorli://server/<host>` and `squorli://invite/<host>/<code>` from a browser or another program. The system starts the
 * app with the link as an argument; when the app already runs, the second start hands its arguments over and quits
 * (single-instance lock). The link is checked here and again by the client (`parseDeepLink`), which decides what to do:
 * it never signs in on a server by itself (docs/features/desktop.md).
 */

export function handleDeepLinks(getWindow: () => BrowserWindow | null, isClientFrame: (event: IpcMainEvent) => boolean): { deliver: (raw: string | null) => void } {
  let pending: string | null = findDeepLink(process.argv);
  let clientReady = false;
  const deliver = (raw: string | null) => {
    if (!raw || !parseDeepLink(raw)) return;
    const win = getWindow();
    if (clientReady && win && !win.isDestroyed()) win.webContents.send(IPC.deepLink, raw);
    else pending = raw;
  };
  // The client subscribes once it runs; the link the app was started with (or one that came meanwhile) follows.
  ipcMain.on(IPC.deepLinkReady, (event) => {
    if (!isClientFrame(event)) return;
    clientReady = true;
    if (pending) { event.sender.send(IPC.deepLink, pending); pending = null; }
  });
  // A reload of the page starts the client anew.
  app.on("web-contents-created", (_e, contents) => contents.on("did-start-navigation", (_ev, _url, _inPlace, isMainFrame) => { if (isMainFrame && contents === getWindow()?.webContents) clientReady = false; }));
  // macOS hands links over as an event instead of an argument.
  app.on("open-url", (event, url) => { event.preventDefault(); deliver(url); });
  // The installer registers the scheme (electron-builder `protocols`); an AppImage has no installer, so a packaged app also
  // registers itself. An unpackaged app never touches the system's registration.
  if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  return { deliver };
}

import { clipboard, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { contextMenuEntries, readContextTarget, type ShellLanguage } from "./contextMenuItems";
import { openExternal } from "./security";

/**
 * The window's context menu (contextMenuItems.ts says what it holds): Electron shows none by itself, so the shell builds
 * the ordinary one on every right-click the page did not handle itself (the client's own menus for members, tiles and rail
 * entries call `preventDefault`, and then no `context-menu` event arrives). The editing commands are Electron's roles, which
 * act on the focused field like the keyboard shortcuts do: "Einfügen" fires the page's `paste` event, so a picture in the
 * clipboard reaches the chat's composer the same way Ctrl+V does (apps/web `pasteFiles.ts`). Only the client's own frame
 * gets the menu; the embedded players (Twitch, YouTube) bring their own or none.
 */
export function handleContextMenu(win: BrowserWindow, language: () => ShellLanguage): void {
  const contents = win.webContents;
  contents.on("context-menu", (_event, params) => {
    if (params.frame && params.frame.parent !== null) return;
    const entries = contextMenuEntries(readContextTarget(params), language());
    if (entries.length === 0) return;
    const template = entries.map((entry): MenuItemConstructorOptions => {
      if (entry.type === "separator") return { type: "separator" };
      const item: MenuItemConstructorOptions = { label: entry.label, enabled: entry.enabled };
      switch (entry.action) {
        case "undo": case "redo": case "cut": case "copy": case "paste": case "selectAll": return { ...item, role: entry.action };
        case "suggestion": return { ...item, click: () => contents.replaceMisspelling(entry.word ?? "") };
        case "addToDictionary": return { ...item, click: () => { if (entry.word) contents.session.addWordToSpellCheckerDictionary(entry.word); } };
        case "copyLink": return { ...item, click: () => { if (entry.url) void clipboard.writeText(entry.url).catch(() => undefined); } };
        case "openLink": return { ...item, click: () => { if (entry.url) openExternal(entry.url); } };
        case "copyImage": return { ...item, click: () => contents.copyImageAt(params.x, params.y) };
        // Without a handler for `will-download` Electron asks where to save the file.
        case "saveImage": return { ...item, click: () => { if (entry.url) contents.downloadURL(entry.url); } };
      }
    });
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

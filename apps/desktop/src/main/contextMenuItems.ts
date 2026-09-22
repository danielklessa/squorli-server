import { isAllowedExternal } from "./navigation";

/**
 * The context menu of the app's window (user's wish, 23 September 2026): the ordinary things a browser offers by itself
 * (cut, copy, paste, undo, select all, spelling suggestions, a link, a picture), which Electron does not show unless the
 * shell builds them. Pure and tested: what the menu holds for one right-click, in the client's language. `contextMenu.ts`
 * turns the entries into Electron's menu and carries the actions out.
 */
export type ShellLanguage = "de" | "en";

/** What lies under the pointer, read from Electron's `ContextMenuParams` (`readContextTarget`). */
export type ContextTarget = {
  editable: boolean;
  flags: { undo: boolean; redo: boolean; cut: boolean; copy: boolean; paste: boolean; selectAll: boolean };
  selection: string;
  /** A link under the pointer (http, https or mailto); null = none. */
  link: string | null;
  /** The address of a picture under the pointer; null = none. */
  image: string | null;
  misspelled: string | null;
  suggestions: string[];
};

export type MenuAction = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "suggestion" | "addToDictionary" | "copyLink" | "openLink" | "copyImage" | "saveImage";
export type MenuEntry = { type: "separator" } | { type: "item"; action: MenuAction; label: string; enabled: boolean; word?: string; url?: string };

const LABELS: Record<ShellLanguage, Record<Exclude<MenuAction, "suggestion"> | "noSuggestions", string>> = {
  de: { undo: "Rückgängig", redo: "Wiederholen", cut: "Ausschneiden", copy: "Kopieren", paste: "Einfügen", selectAll: "Alles auswählen", addToDictionary: "Zum Wörterbuch hinzufügen", noSuggestions: "Keine Vorschläge", copyLink: "Link kopieren", openLink: "Link im Browser öffnen", copyImage: "Bild kopieren", saveImage: "Bild speichern unter…" },
  en: { undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all", addToDictionary: "Add to dictionary", noSuggestions: "No suggestions", copyLink: "Copy link", openLink: "Open link in browser", copyImage: "Copy image", saveImage: "Save image as…" },
};

/** At most this many spelling suggestions. */
const MAX_SUGGESTIONS = 5;

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const isWebLink = (url: string): boolean => /^https?:\/\//i.test(url);

/** The client's language as it says it (`IPC.language`); anything else keeps `fallback`. */
export function readShellLanguage(value: unknown, fallback: ShellLanguage): ShellLanguage {
  return value === "de" || value === "en" ? value : fallback;
}

/** The language for the shell's own texts before the client said anything: from the system's locale. */
export function languageOfLocale(locale: string): ShellLanguage {
  return locale.toLowerCase().startsWith("de") ? "de" : "en";
}

/** Electron's `ContextMenuParams` reduced to what the menu needs; every missing or odd field counts as absent. */
export function readContextTarget(params: unknown): ContextTarget {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const flags = (p.editFlags && typeof p.editFlags === "object" ? p.editFlags : {}) as Record<string, unknown>;
  const link = str(p.linkURL);
  const src = str(p.srcURL);
  const misspelled = str(p.misspelledWord);
  return {
    editable: p.isEditable === true,
    flags: { undo: flags.canUndo === true, redo: flags.canRedo === true, cut: flags.canCut === true, copy: flags.canCopy === true, paste: flags.canPaste === true, selectAll: flags.canSelectAll === true },
    selection: str(p.selectionText),
    link: link && (isWebLink(link) || /^mailto:/i.test(link)) ? link : null,
    image: p.mediaType === "image" && src ? src : null,
    misspelled: misspelled || null,
    suggestions: Array.isArray(p.dictionarySuggestions) ? p.dictionarySuggestions.filter((s): s is string => typeof s === "string" && s.length > 0) : [],
  };
}

/** The menu for one right-click; an empty list = no menu (nothing under the pointer to act on). */
export function contextMenuEntries(target: ContextTarget, language: ShellLanguage): MenuEntry[] {
  const L = LABELS[language];
  const item = (action: Exclude<MenuAction, "suggestion">, enabled: boolean, extra: { word?: string; url?: string } = {}): MenuEntry => ({ type: "item", action, label: L[action], enabled, ...extra });
  const sections: MenuEntry[][] = [];

  // Spelling first, as every browser does: the suggestions, or that there are none, and the word into the dictionary.
  if (target.editable && target.misspelled) {
    const suggestions = target.suggestions.slice(0, MAX_SUGGESTIONS).map((word): MenuEntry => ({ type: "item", action: "suggestion", label: word, enabled: true, word }));
    sections.push([
      ...(suggestions.length > 0 ? suggestions : [{ type: "item", action: "addToDictionary", label: L.noSuggestions, enabled: false } as MenuEntry]),
      item("addToDictionary", true, { word: target.misspelled }),
    ]);
  }
  if (target.editable) {
    sections.push([item("undo", target.flags.undo), item("redo", target.flags.redo)]);
    sections.push([item("cut", target.flags.cut), item("copy", target.flags.copy), item("paste", target.flags.paste)]);
    sections.push([item("selectAll", target.flags.selectAll)]);
  } else if (target.selection.trim()) {
    sections.push([item("copy", true)]);
  }
  if (target.link) {
    const link = [item("copyLink", true, { url: target.link })];
    if (isAllowedExternal(target.link)) link.push(item("openLink", true, { url: target.link }));
    sections.push(link);
  }
  if (target.image) {
    const image = [item("copyImage", true)];
    // Saving goes through the network: a picture served by a server, not a blob or data address of the page's own.
    if (isWebLink(target.image)) image.push(item("saveImage", true, { url: target.image }));
    sections.push(image);
  }

  const entries: MenuEntry[] = [];
  for (const section of sections) {
    if (section.length === 0) continue;
    if (entries.length > 0) entries.push({ type: "separator" });
    entries.push(...section);
  }
  return entries;
}

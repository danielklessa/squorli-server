import { describe, expect, it } from "vitest";
import { contextMenuEntries, languageOfLocale, readContextTarget, readShellLanguage, type ContextTarget, type MenuEntry } from "./contextMenuItems";

const none: ContextTarget = { editable: false, flags: { undo: false, redo: false, cut: false, copy: false, paste: false, selectAll: false }, selection: "", link: null, image: null, misspelled: null, suggestions: [] };
const field: ContextTarget = { ...none, editable: true, flags: { undo: true, redo: false, cut: false, copy: false, paste: true, selectAll: true } };

const shape = (entries: MenuEntry[]) => entries.map((e) => (e.type === "separator" ? "-" : `${e.action}${e.enabled ? "" : "!"}`));
const labels = (entries: MenuEntry[]) => entries.map((e) => (e.type === "separator" ? "-" : e.label));

describe("readContextTarget", () => {
  it("reduces Electron's params and drops what is odd", () => {
    const target = readContextTarget({
      isEditable: true, editFlags: { canUndo: true, canRedo: "yes", canCut: false, canCopy: true, canPaste: true, canSelectAll: true },
      selectionText: "hallo", linkURL: "https://example.org/a", mediaType: "image", srcURL: "https://chat.example.org/api/attachments/1",
      misspelledWord: "Wrold", dictionarySuggestions: ["World", 7, "", "Word"],
    });
    expect(target).toEqual({
      editable: true, flags: { undo: true, redo: false, cut: false, copy: true, paste: true, selectAll: true }, selection: "hallo",
      link: "https://example.org/a", image: "https://chat.example.org/api/attachments/1", misspelled: "Wrold", suggestions: ["World", "Word"],
    });
  });
  it("counts only web and mail links, and only a picture as a picture", () => {
    expect(readContextTarget({ linkURL: "javascript:alert(1)" }).link).toBeNull();
    expect(readContextTarget({ linkURL: "squorli://join/x" }).link).toBeNull();
    expect(readContextTarget({ linkURL: "mailto:a@b.c" }).link).toBe("mailto:a@b.c");
    expect(readContextTarget({ mediaType: "video", srcURL: "https://x/y.mp4" }).image).toBeNull();
    expect(readContextTarget({ mediaType: "image", srcURL: "" }).image).toBeNull();
    expect(readContextTarget(null)).toEqual(none);
    expect(readContextTarget("x")).toEqual(none);
  });
});

describe("contextMenuEntries", () => {
  it("shows nothing for a right-click on the background", () => {
    expect(contextMenuEntries(none, "de")).toEqual([]);
  });
  it("offers the editing commands in a field, with the flags as Electron reports them", () => {
    const entries = contextMenuEntries(field, "de");
    expect(shape(entries)).toEqual(["undo", "redo!", "-", "cut!", "copy!", "paste", "-", "selectAll"]);
    expect(labels(entries)).toEqual(["Rückgängig", "Wiederholen", "-", "Ausschneiden", "Kopieren", "Einfügen", "-", "Alles auswählen"]);
    expect(labels(contextMenuEntries(field, "en"))).toEqual(["Undo", "Redo", "-", "Cut", "Copy", "Paste", "-", "Select all"]);
  });
  it("puts spelling suggestions first, at most five, then the word for the dictionary", () => {
    const entries = contextMenuEntries({ ...field, misspelled: "Wrold", suggestions: ["World", "Word", "Wold", "Wrote", "Wrong", "Would"] }, "en");
    expect(shape(entries).slice(0, 8)).toEqual(["suggestion", "suggestion", "suggestion", "suggestion", "suggestion", "addToDictionary", "-", "undo"]);
    expect(entries[0]).toMatchObject({ label: "World", word: "World" });
    expect(entries[5]).toMatchObject({ label: "Add to dictionary", word: "Wrold" });
  });
  it("says when there are no suggestions", () => {
    const entries = contextMenuEntries({ ...field, misspelled: "Wrold" }, "de");
    expect(labels(entries).slice(0, 3)).toEqual(["Keine Vorschläge", "Zum Wörterbuch hinzufügen", "-"]);
    expect(entries[0]).toMatchObject({ enabled: false });
  });
  it("ignores a misspelling outside a field", () => {
    expect(contextMenuEntries({ ...none, misspelled: "Wrold", suggestions: ["World"] }, "de")).toEqual([]);
  });
  it("copies a selection outside a field", () => {
    expect(shape(contextMenuEntries({ ...none, selection: "ein Satz" }, "de"))).toEqual(["copy"]);
    expect(contextMenuEntries({ ...none, selection: "   " }, "de")).toEqual([]);
  });
  it("offers a link to copy and to open in the browser", () => {
    const entries = contextMenuEntries({ ...none, link: "https://example.org/a" }, "en");
    expect(shape(entries)).toEqual(["copyLink", "openLink"]);
    expect(entries[0]).toMatchObject({ url: "https://example.org/a" });
    expect(labels(entries)).toEqual(["Copy link", "Open link in browser"]);
  });
  it("offers a picture to copy, and to save when a server serves it", () => {
    expect(shape(contextMenuEntries({ ...none, image: "https://chat.example.org/api/attachments/1" }, "de"))).toEqual(["copyImage", "saveImage"]);
    expect(shape(contextMenuEntries({ ...none, image: "blob:app://squorli/1234" }, "de"))).toEqual(["copyImage"]);
    expect(shape(contextMenuEntries({ ...none, image: "data:image/png;base64,AAAA" }, "de"))).toEqual(["copyImage"]);
  });
  it("separates the sections and never doubles a separator", () => {
    const entries = contextMenuEntries({ ...none, selection: "text", link: "https://example.org/a", image: "https://example.org/p.png" }, "de");
    expect(shape(entries)).toEqual(["copy", "-", "copyLink", "openLink", "-", "copyImage", "saveImage"]);
    const inField = contextMenuEntries({ ...field, link: "mailto:a@b.c" }, "en");
    expect(shape(inField)).toEqual(["undo", "redo!", "-", "cut!", "copy!", "paste", "-", "selectAll", "-", "copyLink", "openLink"]);
  });
});

describe("language of the shell", () => {
  it("follows the client's word and keeps the old one otherwise", () => {
    expect(readShellLanguage("de", "en")).toBe("de");
    expect(readShellLanguage("fr", "en")).toBe("en");
    expect(readShellLanguage(null, "de")).toBe("de");
  });
  it("starts from the system's locale", () => {
    expect(languageOfLocale("de-AT")).toBe("de");
    expect(languageOfLocale("en-US")).toBe("en");
    expect(languageOfLocale("fr")).toBe("en");
  });
});

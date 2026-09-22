import { describe, expect, it } from "vitest";
import { pastedFiles, pastedImageName } from "./pasteFiles";

type FakeItem = { kind: string; type: string; file?: File };
const transfer = (items: FakeItem[], files: File[] = []) => ({
  items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null, getAsString: () => {} })) as unknown as DataTransferItemList,
  files: files as unknown as FileList,
});
const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const at = new Date(2026, 8, 23, 14, 5, 7);

describe("pastedFiles", () => {
  it("takes nothing from plain text", () => {
    expect(pastedFiles(transfer([{ kind: "string", type: "text/plain" }]))).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
    expect(pastedFiles(undefined)).toEqual([]);
  });
  it("renames a clipboard picture with the time and keeps its type", () => {
    const files = pastedFiles(transfer([{ kind: "string", type: "text/html" }, { kind: "file", type: "image/png", file: png("image.png") }]), at);
    expect(files.map((f) => [f.name, f.type, f.size])).toEqual([["image-2026-09-23-14-05-07.png", "image/png", 4]]);
  });
  it("keeps the name of a file copied in the file manager", () => {
    const doc = new File(["x"], "Bericht.pdf", { type: "application/pdf" });
    const photo = new File(["x"], "Urlaub.jpg", { type: "image/jpeg" });
    expect(pastedFiles(transfer([{ kind: "file", type: doc.type, file: doc }, { kind: "file", type: photo.type, file: photo }]), at).map((f) => f.name)).toEqual(["Bericht.pdf", "Urlaub.jpg"]);
  });
  it("falls back to the file list when there are no items", () => {
    expect(pastedFiles({ items: [] as unknown as DataTransferItemList, files: [png("image.png")] as unknown as FileList }, at).map((f) => f.name)).toEqual(["image-2026-09-23-14-05-07.png"]);
  });
  it("names by type", () => {
    expect(pastedImageName("image/jpeg", at)).toBe("image-2026-09-23-14-05-07.jpg");
    expect(pastedImageName("image/webp", at)).toBe("image-2026-09-23-14-05-07.webp");
    expect(pastedImageName("image/x-odd", at)).toBe("image-2026-09-23-14-05-07.png");
  });
});

/**
 * How this installation can update: by itself (Windows installer, AppImage), by hand (a deb cannot replace itself; the client
 * links to the download page), or not at all (unpackaged, other platforms). Pure (tested), no Electron import.
 */
export function updateMode(o: { packaged: boolean; platform: string; appImage: boolean }): "self" | "manual" | "none" {
  if (!o.packaged) return "none";
  if (o.platform === "win32") return "self";
  if (o.platform === "linux") return o.appImage ? "self" : "manual";
  return "none";
}

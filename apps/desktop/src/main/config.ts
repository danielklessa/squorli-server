import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Settings of the shell itself, per device: `<userData>/desktop-config.json`. Read synchronously once, before the window exists. */
export type DesktopConfig = { appearance?: unknown };

export function loadConfig(userData: string): DesktopConfig {
  try { const v = JSON.parse(readFileSync(join(userData, "desktop-config.json"), "utf8")) as unknown; return typeof v === "object" && v !== null ? v as DesktopConfig : {}; } catch { return {}; }
}
export function saveConfig(userData: string, config: DesktopConfig): void {
  try { writeFileSync(join(userData, "desktop-config.json"), JSON.stringify(config, null, 2)); } catch { /* the setting then lasts until the app closes */ }
}

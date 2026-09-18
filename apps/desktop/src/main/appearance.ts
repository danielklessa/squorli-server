import { WINDOW_OPACITY_MIN, type WindowAppearance, type WindowMaterial } from "@squorli/web/platform/bridge";

/**
 * Window background of the app (user's wish, docs/features/desktop.md): a system material behind the client (Windows 11:
 * mica or acrylic) and how opaque the client's own surfaces are. Pure part (tested); `index.ts` applies it to the window
 * and keeps it in `desktop-config.json` (per device, read before the window exists so nothing flashes).
 */
export const DEFAULT_APPEARANCE: WindowAppearance = { material: "none", opacity: 1 };

/** Materials this system offers besides "none": Windows 11 22H2 (build 22621) and later. */
export function supportedMaterials(platform: string, release: string): WindowMaterial[] {
  if (platform !== "win32") return [];
  const build = Number(release.split(".")[2] ?? 0);
  return build >= 22621 ? ["mica", "acrylic"] : [];
}

/** Whatever was stored or sent becomes a valid appearance for this system. */
export function normalizeAppearance(value: unknown, supported: readonly WindowMaterial[]): WindowAppearance {
  const v = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof WindowAppearance, unknown>>;
  const material = supported.find((m) => m === v.material) ?? "none";
  const opacity = typeof v.opacity === "number" && Number.isFinite(v.opacity) ? Math.min(1, Math.max(WINDOW_OPACITY_MIN, Math.round(v.opacity * 100) / 100)) : 1;
  return { material, opacity };
}

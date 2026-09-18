import { WINDOW_OPACITY_MIN, type AppearanceState, type WindowAppearance, type WindowMaterial } from "@squorli/web/platform/bridge";

/**
 * Window background of the app (user's wish and decision, docs/features/desktop.md): opaque, Windows 11's mica behind the
 * whole window, or a really see-through window ("clear") whose gaps show the desktop. Pure part (tested); `index.ts` applies
 * it to the window and keeps it in `desktop-config.json` (per device, read before the window exists so nothing flashes).
 *
 * A window is created see-through or not and stays that way: changing to or from "clear" is stored at once and takes
 * effect with the next start. Mica and opaque switch while the app runs.
 */
export const DEFAULT_APPEARANCE: WindowAppearance = { material: "none", opacity: 1 };

/** What this system offers besides "none": mica on Windows 11 22H2 (build 22621) and later, a see-through window on Windows and Linux. */
export function supportedMaterials(platform: string, release: string): WindowMaterial[] {
  if (platform === "win32") return Number(release.split(".")[2] ?? 0) >= 22621 ? ["mica", "clear"] : ["clear"];
  return platform === "linux" ? ["clear"] : [];
}

/** Whatever was stored or sent becomes a valid appearance for this system. */
export function normalizeAppearance(value: unknown, supported: readonly WindowMaterial[]): WindowAppearance {
  const v = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof WindowAppearance, unknown>>;
  const material = supported.find((m) => m === v.material) ?? "none";
  const opacity = typeof v.opacity === "number" && Number.isFinite(v.opacity) ? Math.min(1, Math.max(WINDOW_OPACITY_MIN, Math.round(v.opacity * 100) / 100)) : 1;
  return { material, opacity };
}

/**
 * What the running window shows for a stored appearance. `transparentWindow` = how the window was created. A see-through
 * window shows "clear" whatever is stored; any other window shows the stored mica/opaque, and keeps `shown` (what it showed
 * so far) while "clear" waits for the restart.
 */
export function appearanceState(appearance: WindowAppearance, transparentWindow: boolean, shown: WindowMaterial): AppearanceState {
  const wantsClear = appearance.material === "clear";
  const effective: WindowMaterial = transparentWindow ? "clear" : wantsClear ? (shown === "clear" ? "none" : shown) : appearance.material;
  return { appearance, effective, needsRestart: wantsClear !== transparentWindow };
}

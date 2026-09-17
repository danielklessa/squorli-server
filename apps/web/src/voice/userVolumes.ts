/**
 * Playback volume per person (0..2 = 0 %..200 %): turn loud speakers down and quiet ones up. Local playback only,
 * nothing is sent to anyone. Keyed by the person's public key, so it holds on every server; stored per device
 * (`chat.userVolumes.v1`), because it depends on the headset and ears in front of this browser.
 */
export const USER_VOLUME_MAX = 2;
const KEY = "chat.userVolumes.v1";

export type UserVolumes = Record<string, number>;

/** Anything that is not a number counts as 100 %. */
export function clampUserVolume(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(USER_VOLUME_MAX, v)) : 1;
}

/** Stored JSON -> volumes; broken or foreign data yields an empty map, entries at 100 % are dropped. */
export function parseUserVolumes(raw: string | null): UserVolumes {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: UserVolumes = {};
    for (const [key, v] of Object.entries(data)) if (typeof v === "number" && clampUserVolume(v) !== 1) out[key] = clampUserVolume(v);
    return out;
  } catch { return {}; }
}

/** New map with this person's volume; 100 % removes the entry, so the store only holds real adjustments. */
export function withUserVolume(all: UserVolumes, key: string, volume: number): UserVolumes {
  const { [key]: _old, ...rest } = all;
  const v = clampUserVolume(volume);
  return v === 1 ? rest : { ...rest, [key]: v };
}

export function loadUserVolumes(): UserVolumes {
  try { return parseUserVolumes(localStorage.getItem(KEY)); } catch { return {}; }
}

export function saveUserVolumes(all: UserVolumes): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or blocked: the volume still applies for this session */ }
}

/**
 * The mark on the task bar icon and the tray icon: direct messages and mentions that wait (user's wish, 20 September 2026).
 * The client counts (apps/web/src/attention.ts) and sends a number; pure part, tested.
 */
const MAX = 9999;

/** What the client sent, as a count; anything that is not a sensible number is 0. */
export function readAttentionCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(MAX, Math.floor(value)) : 0;
}

/** The overlay image for a count (build/badge-*.png, tools/desktop-icon.mjs); null = no mark. */
export function badgeFile(count: number): string | null {
  return count <= 0 ? null : count > 9 ? "badge-9plus.png" : `badge-${count}.png`;
}

/** Tool tip of the tray icon and the overlay's description for screen readers. */
export function attentionText(count: number, german: boolean): string {
  if (count <= 0) return "Squorli";
  return german ? `Squorli: ${count} neue ${count === 1 ? "Nachricht" : "Nachrichten"} für dich` : `Squorli: ${count} new ${count === 1 ? "message" : "messages"} for you`;
}

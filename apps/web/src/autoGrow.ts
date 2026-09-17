/** Share of the chat area's height a text input may take before it scrolls (user's wish, 17 September 2026). */
export const INPUT_MAX_SHARE = 1 / 3;
/** The limit never falls below about two lines, e.g. on a phone with the keyboard open. */
export const INPUT_MIN_LIMIT = 64;

/** Height for a growing text input: as high as its content, at most the share of the available height; beyond that it scrolls. */
export function grownHeight(content: number, available: number, share = INPUT_MAX_SHARE): { height: number; scroll: boolean } {
  // An area that is not laid out yet (0) must not squash the input: then the content decides.
  if (available <= 0) return { height: content, scroll: false };
  const max = Math.max(Math.floor(available * share), INPUT_MIN_LIMIT);
  return content <= max ? { height: content, scroll: false } : { height: max, scroll: true };
}

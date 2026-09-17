/**
 * Radio button: may the other text (what the station is playing) stand in place of the usual one (the station's name)?
 * Only when it can be shown in full. All widths in px: `wanted` = the title at full length, `shown` = the label as it is
 * laid out right now (whichever text it holds), `truncated` = that label is cut off, `free` = unused space in the row,
 * `max` = the widest the label may get.
 * The answer must not depend on which text is showing, or the label would flip back and forth: showing the longer text
 * uses up exactly the free space it needed, so `shown + free` is the same before and after. A row so crowded that the
 * label is cut off has no room at all, whatever the widths say (a shorter text would only be squeezed in turn).
 */
export function fitsInstead({ wanted, shown, truncated, free, max }: { wanted: number; shown: number; truncated: boolean; free: number; max: number }): boolean {
  if (wanted <= 0 || truncated) return false;
  const tolerance = 0.5; // sub-pixel layout
  return wanted <= max + tolerance && wanted <= shown + free + tolerance;
}

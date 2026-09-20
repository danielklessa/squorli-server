/**
 * What wants the user's attention: new direct messages and messages that mention them (user's wish, 20 September 2026: a
 * sound in every client, a mark on the desktop app's task bar icon). Pure; store.ts and App.tsx hold the state.
 */

/**
 * Does the user see a message the moment it arrives? Only in a window that is visible AND has the focus and shows exactly
 * that conversation. A window on a second monitor without the focus does not count: nobody can tell where the user looks.
 */
export function seesIncoming(window: { visible: boolean; focused: boolean }, showing: boolean): boolean {
  return window.visible && window.focused && showing;
}

/**
 * The number for the task bar mark: unread direct messages plus mentions, as the client's own marks count them. Those marks
 * leave out what arrived in the conversation that is open (a channel stays "current" while the window is minimized), so
 * `missed` = what arrived while the window did not have the focus counts as well; it is cleared when the window gets it back.
 */
export function attentionCount(dmUnread: readonly number[], mentions: readonly number[], missed: number): number {
  const sum = (list: readonly number[]) => list.reduce((n, c) => n + Math.max(0, c), 0);
  return Math.max(sum(dmUnread) + sum(mentions), Math.max(0, missed));
}

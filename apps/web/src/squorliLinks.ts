import { parseDeepLink } from "./platform/deepLink";

/**
 * `squorli://` links in chat messages (23 September 2026, user's wish): `squorli://server/<host>` and
 * `squorli://invite/<host>/<code>` are links like any web address (markdown.ts), nothing else of that scheme is, so a
 * `squorli://control/...` command can never hide behind a label. A click in a client without a home server (the desktop
 * app) shows the server in the client itself (store `openLink`); in a browser the link goes to the system, which opens the
 * desktop app when it is installed.
 */
let handler: ((href: string) => boolean) | null = null;

/** App.tsx registers what a click does; null = nothing takes them, the browser follows the link. */
export function setSquorliLinkHandler(fn: ((href: string) => boolean) | null): void { handler = fn; }

export const isSquorliLink = (href: string): boolean => /^squorli:/i.test(href);

/** true = the client showed the server itself and the click must not go on; false = let the browser hand the link to the system. */
export function openSquorliLink(href: string): boolean {
  return parseDeepLink(href) !== null && !!handler && handler(href);
}

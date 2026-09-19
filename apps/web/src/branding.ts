/**
 * Page title and favicon: always the server name (from /api/health even before sign-in), the server icon from the
 * admin area as the favicon, otherwise the Squorli mark (docs/brand).
 */
const DEFAULT_ICON = "/brand/squorli-icon-small.svg";

/** The name a phone offers when the client is put on its home screen; the same rule as the server's manifest (apps/server/src/webManifest.ts). */
export const homeScreenName = (serverName: string | null | undefined): string => {
  const name = serverName?.trim();
  return name ? `Squorli - ${name}` : "Squorli";
};

/**
 * iOS takes the home screen name from this tag (Android and others from the manifest). Always the HOME server, the one that
 * serves the page and that the icon on the home screen opens, not the server displayed right now.
 */
export function applyHomeScreenName(serverName: string | null | undefined) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  const content = homeScreenName(serverName);
  if (meta && meta.content !== content) meta.content = content;
}

export function applyBranding(title: string, iconUrl: string | null) {
  if (document.title !== title) document.title = title;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.append(link); }
  const href = iconUrl ?? DEFAULT_ICON;
  if (link.getAttribute("href") === href) return;
  link.href = href;
  if (iconUrl) link.removeAttribute("type"); else link.type = "image/svg+xml";
}

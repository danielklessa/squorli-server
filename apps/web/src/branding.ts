/**
 * Page title and favicon: always the server name (from /api/health even before sign-in), the server icon from the
 * admin area as the favicon, otherwise the Squorli mark (docs/brand).
 */
const DEFAULT_ICON = "/brand/squorli-icon-small.svg";

export function applyBranding(title: string, iconUrl: string | null) {
  if (document.title !== title) document.title = title;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.append(link); }
  const href = iconUrl ?? DEFAULT_ICON;
  if (link.getAttribute("href") === href) return;
  link.href = href;
  if (iconUrl) link.removeAttribute("type"); else link.type = "image/svg+xml";
}

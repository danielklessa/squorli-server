/**
 * Seitentitel und Favicon: immer der Servername (schon vor dem Login aus /api/health), das Server-Icon aus der
 * Verwaltung als Favicon, sonst das Squorli-Signet (docs/brand).
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

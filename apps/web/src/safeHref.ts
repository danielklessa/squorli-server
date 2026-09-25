/**
 * A link target the client renders from data of a server or a peer (link previews, attachments of other servers, a server's
 * directory address): only web addresses. Anything else (`javascript:`, `data:`) becomes undefined, so the link does nothing
 * (security review, 25 September 2026). A relative path counts by the page's own address. Messages' own links go through
 * markdown.ts instead.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url, globalThis.location?.href);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

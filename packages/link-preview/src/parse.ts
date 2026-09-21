/**
 * What a web page says about itself, read from the head of its HTML without a parser library: Open Graph (`og:*`), the
 * Twitter card's fields, `<meta name="description">` and `<title>`. Pure and tested. Everything here comes from a foreign
 * host: it ends up as text in React elements (never as HTML), is cut to the protocol's lengths, loses control characters,
 * and the picture's address only counts when it is http(s).
 */
export type PageMeta = { title: string | null; description: string | null; siteName: string | null; imageUrl: string | null };

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", euro: "€", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,10});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? whole;
  });
}

/** One line of plain text: entities decoded, control characters and line breaks gone, cut to `max`. null = nothing left. */
export function cleanText(raw: string | undefined, max: number): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw).replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const attrRe = /([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(attrRe)) { const name = m[1]!.toLowerCase(); if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? ""); }
  return out;
}

export function parsePageMeta(html: string, baseUrl: string): PageMeta {
  // Only the head: what stands in the body is the page's content, not its description of itself.
  const bodyAt = html.search(/<body[\s>]/i);
  const head = (bodyAt >= 0 ? html.slice(0, bodyAt) : html).replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.get("property") ?? a.get("name") ?? "").toLowerCase();
    const content = a.get("content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  const first = (...keys: string[]) => { for (const k of keys) { const v = meta.get(k); if (v?.trim()) return v; } return undefined; };

  let imageUrl: string | null = null;
  const image = first("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src");
  if (image) {
    try { const u = new URL(decodeEntities(image).trim(), baseUrl); if (u.protocol === "http:" || u.protocol === "https:") imageUrl = u.href; } catch { imageUrl = null; }
  }
  return {
    title: cleanText(first("og:title", "twitter:title") ?? titleTag, 300),
    description: cleanText(first("og:description", "twitter:description", "description"), 500),
    siteName: cleanText(first("og:site_name", "application-name"), 100),
    imageUrl,
  };
}

/** The charset a page names for itself: the Content-Type header first, then a `<meta charset>` near the top; utf-8 otherwise. */
export function decodeHtml(bytes: Buffer, contentType: string): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(bytes.subarray(0, 2048).toString("latin1"))?.[1];
  for (const label of [fromHeader, fromMeta, "utf-8"]) {
    if (!label) continue;
    try { return new TextDecoder(label).decode(bytes); } catch { /* a label nobody knows: try the next */ }
  }
  return bytes.toString("utf8");
}

export type ImageType = { mime: string; ext: "png" | "jpg" | "webp" | "gif" };
/** The picture's type by its first bytes, whatever the host calls it. No SVG: it is a document, not a picture. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { mime: "image/gif", ext: "gif" };
  return null;
}

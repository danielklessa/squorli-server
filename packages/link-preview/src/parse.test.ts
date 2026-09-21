import { describe, expect, it } from "vitest";
import { cleanText, decodeEntities, decodeHtml, parsePageMeta, sniffImage } from "./parse";

describe("parsePageMeta", () => {
  it("prefers Open Graph, in any attribute order and quoting", () => {
    const html = `<!doctype html><html><head><title>Nur der Titel</title>
      <meta content="Der OG-Titel &amp; mehr" property="og:title">
      <meta property='og:description' content='Eine Beschreibung&#44; kurz'>
      <meta property=og:site_name content=Beispiel>
      <meta property="og:image" content="/bilder/vorschau.png?a=1&amp;b=2">
      </head><body><meta property="og:title" content="aus dem Body"></body></html>`;
    expect(parsePageMeta(html, "https://example.org/artikel/1")).toEqual({
      title: "Der OG-Titel & mehr", description: "Eine Beschreibung, kurz", siteName: "Beispiel", imageUrl: "https://example.org/bilder/vorschau.png?a=1&b=2",
    });
  });

  it("falls back to the Twitter card, the description and the title tag", () => {
    const html = `<head><title>\n  Titel über\n  zwei Zeilen </title><meta name="description" content="Beschreibung"><meta name="twitter:image" content="https://cdn.example.com/a.jpg"></head>`;
    expect(parsePageMeta(html, "https://example.org/")).toEqual({ title: "Titel über zwei Zeilen", description: "Beschreibung", siteName: null, imageUrl: "https://cdn.example.com/a.jpg" });
  });

  it("ignores scripts, comments and pictures that are not http(s)", () => {
    const html = `<head><script>var t = "<title>falsch</title>";</script><!-- <meta property="og:title" content="auskommentiert"> -->
      <title>Richtig</title><meta property="og:image" content="javascript:alert(1)"></head>`;
    expect(parsePageMeta(html, "https://example.org/")).toEqual({ title: "Richtig", description: null, siteName: null, imageUrl: null });
    expect(parsePageMeta(`<meta property="og:image" content="data:image/png;base64,AAAA">`, "https://example.org/").imageUrl).toBeNull();
  });

  it("a page that says nothing has nothing", () => {
    expect(parsePageMeta("<html><body>Hallo</body></html>", "https://example.org/")).toEqual({ title: null, description: null, siteName: null, imageUrl: null });
  });
});

describe("text from a foreign host", () => {
  it("decodes entities, also numeric ones, and leaves unknown ones alone", () => {
    expect(decodeEntities("&lt;b&gt; &#x1F600; &#228; &auml; &unbekannt; &#xD800;")).toBe("<b> 😀 ä ä &unbekannt; ");
  });
  it("becomes one line without control characters and is cut", () => {
    expect(cleanText("a\u0000b\r\n c‮ d", 100)).toBe("a b c d");
    expect(cleanText("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
    expect(cleanText("  \n ", 10)).toBeNull();
  });
});

describe("decodeHtml", () => {
  it("takes the charset from the header, then from the page, then utf-8", () => {
    const latin = Buffer.from("<title>Gr\xfc\xdfe</title>", "latin1");
    expect(decodeHtml(latin, "text/html; charset=ISO-8859-1")).toContain("Grüße");
    expect(decodeHtml(Buffer.concat([Buffer.from("<meta charset=\"windows-1252\">", "latin1"), latin]), "text/html")).toContain("Grüße");
    expect(decodeHtml(Buffer.from("<title>Grüße</title>", "utf8"), "text/html; charset=quatsch")).toContain("Grüße");
  });
});

describe("sniffImage", () => {
  it("knows the four raster types by their bytes and nothing else", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe("png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))?.ext).toBe("webp");
    expect(sniffImage(Buffer.from("GIF89a", "latin1"))?.ext).toBe("gif");
    expect(sniffImage(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\">", "latin1"))).toBeNull();
  });
});

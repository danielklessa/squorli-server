#!/usr/bin/env node
/**
 * Icon-Webfont fuer den Web-Client: Lucide (ISC-Lizenz), selbst gehostet, nur die benutzten Symbole.
 *
 * Liest alle `<Icon name="…">`-Vorkommen in apps/web/src, holt die Codepoints aus lucide-static/font/lucide.css und
 * schreibt apps/web/src/icons/icons.css (mit @font-face auf die mitkopierte lucide.woff2). Laeuft in `pnpm build`
 * und per `pnpm icons`. Bricht ab, wenn ein Name in Lucide nicht existiert (Tippfehler faellt so beim Build auf).
 * Namen nachschlagen: https://lucide.dev/icons
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "apps", "web", "src");
const fontDir = join(root, "apps", "web", "node_modules", "lucide-static", "font");
const outDir = join(srcDir, "icons");

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

const names = new Set();
for (const f of walk(srcDir)) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/<Icon\b[^>]*\bname=(?:"([a-z0-9-]+)"|\{[^}]*?\?\s*"([a-z0-9-]+)"\s*:\s*"([a-z0-9-]+)"[^}]*\})/g)) {
    for (const n of m.slice(1)) if (n) names.add(n);
  }
  // Auch Namen aus Konstanten/Objekten: alle "…" nach `icon:` oder in ICONS-Tabellen
  for (const m of text.matchAll(/\bicon(?:Name)?:\s*"([a-z0-9-]+)"/g)) names.add(m[1]);
}

const css = readFileSync(join(fontDir, "lucide.css"), "utf8");
const rules = new Map();
for (const m of css.matchAll(/\.icon-([a-z0-9-]+)::?before\s*\{\s*content:\s*"([^"]+)";?\s*\}/g)) rules.set(m[1], m[2]);

const missing = [...names].filter((n) => !rules.has(n));
if (missing.length) {
  console.error(`[icons] unbekannte Lucide-Namen: ${missing.join(", ")} (siehe https://lucide.dev/icons)`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(join(fontDir, "lucide.woff2"), join(outDir, "lucide.woff2"));
const sorted = [...names].sort();
const out = [
  "/* GENERIERT von tools/icons.mjs, nicht von Hand aendern. Lucide Icons, ISC-Lizenz (https://lucide.dev). */",
  '@font-face { font-family: "lucide"; src: url("./lucide.woff2") format("woff2"); font-weight: normal; font-style: normal; font-display: block; }',
  '.ic { font-family: "lucide" !important; font-style: normal; font-weight: normal; line-height: 1; display: inline-block; vertical-align: -0.125em; -webkit-font-smoothing: antialiased; }',
  ...sorted.map((n) => `.ic-${n}::before { content: "${rules.get(n)}"; }`),
  "",
].join("\n");
writeFileSync(join(outDir, "icons.css"), out);
console.log(`[icons] ${sorted.length} Symbole: ${sorted.join(", ")}`);

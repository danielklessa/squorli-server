// Generates the icons a phone shows when the web client is put on its home screen (apps/web/public/app-icons/), from the
// brand's icon mark docs/brand/squorli-icon.svg on the brand's dark ground #0C1424 (docs/brand/AGENTS.md: the SVG is
// transparent, the dark background is added in the target medium). Referenced by apps/web/index.html and
// apps/web/public/manifest.webmanifest. The result is committed; run this only after a brand change:
//   node tools/web-app-icons.mjs           (needs Google Chrome; another path: CHROME=<chrome executable>)
// and then raise the `?v=` of the icon addresses in index.html and the manifest (the server lets browsers cache them for a year).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps/web/public/app-icons");
const chrome = process.env.CHROME ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const svg = readFileSync(join(root, "docs/brand/squorli-icon.svg"), "utf8").replace(/<\?xml[^>]*\?>/, "");

// `tile`: how the dark ground is cut. `mark`: size of the SVG's box in percent of the canvas (its view box leaves air around the mark).
const ICONS = [
  // iOS: no transparency (it would turn black) and no corners of our own, iOS rounds the square itself.
  { file: "apple-touch-icon.png", size: 180, tile: "inset: 0;", mark: 88 },
  // Android and others, purpose "any": shown as it is, so the rounded tile of the desktop app's icon (tools/desktop-icon.mjs).
  { file: "icon-192.png", size: 192, tile: "inset: 4%; border-radius: 22%;", mark: 85 },
  { file: "icon-512.png", size: 512, tile: "inset: 4%; border-radius: 22%;", mark: 85 },
  // Purpose "maskable": the launcher cuts any shape out of the full square; only the inner circle of 80 % is safe.
  { file: "icon-maskable-512.png", size: 512, tile: "inset: 0;", mark: 72 },
];

const work = mkdtempSync(join(tmpdir(), "squorli-web-icons-"));
mkdirSync(outDir, { recursive: true });
for (const icon of ICONS) {
  const page = join(work, `${icon.file}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${icon.size}px; height: ${icon.size}px; background: transparent; overflow: hidden; }
  /* Everything hangs on this box, not on the viewport: headless Chrome's window has a minimum size above the small icons. */
  .canvas { position: absolute; left: 0; top: 0; width: ${icon.size}px; height: ${icon.size}px; }
  .tile { position: absolute; ${icon.tile} background: #0C1424; }
  svg { position: absolute; inset: 0; margin: auto; width: ${icon.mark}%; height: ${icon.mark}%; display: block; }
</style><div class="canvas"><div class="tile"></div>${svg}</div>`);
  const out = join(outDir, icon.file);
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${icon.size},${icon.size}`, `--screenshot=${out}`, pathToFileURL(page).href], { stdio: "ignore" });
  console.log(`[web-app-icons] ${out}`);
}
rmSync(work, { recursive: true, force: true });

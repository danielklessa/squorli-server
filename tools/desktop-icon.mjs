// Generates the desktop app's icon (apps/desktop/build/icon.png, 1024 px) from the brand's icon mark: docs/brand/squorli-icon.svg
// on the brand's dark tile (#0C1424, rounded), with the clear space the brand rules ask for. electron-builder derives the
// Windows .ico and the Linux sizes from this one file. The result is committed; run this only after a brand change:
//   node tools/desktop-icon.mjs            (needs Google Chrome; another path: CHROME=<chrome executable>)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/desktop/build/icon.png");
const chrome = process.env.CHROME ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const SIZE = 1024;

const svg = readFileSync(join(root, "docs/brand/squorli-icon.svg"), "utf8");
const work = mkdtempSync(join(tmpdir(), "squorli-icon-"));
const page = join(work, "icon.html");
// Tile: 4 % margin to the canvas, corner radius 22 %. The SVG's own view box leaves air around the mark, so its box takes 92 % of
// the tile: the mark then fills about two thirds of the tile's width (it has to stay readable at 16 px in a task bar) and keeps
// more clear space than the brand's minimum of 1/8 of its width.
writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; background: transparent; overflow: hidden; }
  .tile { position: absolute; inset: 4%; border-radius: 22%; background: #0C1424; display: grid; place-items: center; }
  .tile svg { width: 92%; height: 92%; display: block; }
</style><div class="tile">${svg.replace(/<\?xml[^>]*\?>/, "")}</div>`);
mkdirSync(dirname(out), { recursive: true });
execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${SIZE},${SIZE}`, `--screenshot=${out}`, pathToFileURL(page).href], { stdio: "ignore" });
rmSync(work, { recursive: true, force: true });
console.log(`[desktop-icon] ${out}`);

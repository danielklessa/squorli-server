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
// Tray icon: the brand's small mark (the variant for sizes below 32 px), transparent, 64 px; the app scales it to the tray's size.
const tray = join(root, "apps/desktop/build/tray.png");
const small = readFileSync(join(root, "docs/brand/squorli-icon-small.svg"), "utf8");
const trayPage = join(work, "tray.html");
writeFileSync(trayPage, `<!doctype html><meta charset="utf-8"><style>html, body { margin: 0; width: 64px; height: 64px; background: transparent; overflow: hidden; } svg { width: 64px; height: 64px; display: block; }</style>${small.replace(/<\?xml[^>]*\?>/, "")}`);
execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", "--window-size=64,64", `--screenshot=${tray}`, pathToFileURL(trayPage).href], { stdio: "ignore" });
// Marks for waiting direct messages and mentions (apps/desktop/src/main/attention.ts): the overlay on the task bar icon
// (badge-1 … badge-9, badge-9plus; Windows shows it at 16 px, so the digit fills the circle) and the tray icon with a dot.
// The brand's coral (--sq-coral) with the brand's dark tile colour on it, like the client's own counters.
const shot = (name, size, body) => {
  const page = join(work, `${name}.html`);
  const file = join(root, "apps/desktop/build", `${name}.png`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }</style>${body}`);
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${size},${size}`, `--screenshot=${file}`, pathToFileURL(page).href], { stdio: "ignore" });
  return file;
};
const made = [];
for (const label of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+"]) {
  // Drawn on a canvas and placed by the INK box of the glyphs (measureText), not by the font's line box: a digit has no
  // descender and its own side bearings, so CSS centring leaves it visibly off (user's report, 20 September 2026).
  made.push(shot(`badge-${label === "9+" ? "9plus" : label}`, 64, `<canvas id="c" width="64" height="64" style="display:block"></canvas><script>
    const g = document.getElementById("c").getContext("2d");
    g.fillStyle = "#FF7F91"; g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#0C1424"; g.font = "800 ${label.length > 1 ? 38 : 48}px 'Segoe UI', Arial, sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
    const m = g.measureText(${JSON.stringify(label)});
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    let x = (64 - w) / 2 + m.actualBoundingBoxLeft; const y = (64 - h) / 2 + m.actualBoundingBoxAscent;
    ${label === "1" ? `// The 1 is the exception (user's wish, 20 September 2026): its flag on the left pushes the stem to the right of the
    // middle, which looks off. Its STEM is centred instead: drawn once out of sight, the stem is what the lower half shows.
    const probe = document.createElement("canvas"); probe.width = probe.height = 64;
    const p = probe.getContext("2d"); p.font = g.font; p.fillText("1", x, y);
    const half = Math.round(y - h / 2), data = p.getImageData(0, half, 64, Math.max(1, Math.round(y) - half)).data;
    let left = 64, right = -1;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 127) { const col = ((i - 3) / 4) % 64; if (col < left) left = col; if (col > right) right = col; }
    if (right >= left) x += 32 - (left + right + 1) / 2;` : ""}
    g.fillText(${JSON.stringify(label)}, x, y);
  </script>`));
}
made.push(shot("tray-alert", 64, `<div style="position:relative;width:64px;height:64px">${small.replace(/<\?xml[^>]*\?>/, "").replace("<svg", '<svg style="width:64px;height:64px;display:block"')}<div style="position:absolute;right:0;bottom:0;width:28px;height:28px;border-radius:50%;background:#FF7F91;border:4px solid #0C1424;box-sizing:border-box"></div></div>`));
rmSync(work, { recursive: true, force: true });
console.log([out, tray, ...made].map((f) => `[desktop-icon] ${f}`).join("\n"));

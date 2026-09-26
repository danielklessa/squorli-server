/**
 * The start window (user's wish, 20 September 2026: a splash screen at the start instead of the client's "no server yet",
 * with the update check in it and the update installed there, "so dass der Benutzer das mitbekommt"). Pure part, tested:
 * the page, what it says for each step, and whether an update may be installed at the start. The window is splash.ts.
 *
 * The page is a `data:` address built here: the shell has no renderer code and the web client's build stays free of a page
 * only the app needs. It carries no script; the shell writes status, progress and the skip link into it.
 */
export type SplashStep =
  | { step: "checking" }
  | { step: "downloading"; version: string; percent: number }
  | { step: "installing"; version: string }
  | { step: "starting" }
  /** Development only: the Vite dev server of `--dev-url` does not answer (index.ts loads the page again as soon as it does). */
  | { step: "devServer"; url: string };

export type SplashView = { text: string; percent: number | null; skip: string | null };

const TEXTS = {
  de: { checking: "Suche nach Updates …", downloading: "Update {v} wird geladen …", installing: "Update {v} wird installiert. Squorli startet gleich neu.", starting: "Squorli wird gestartet …", skip: "Später installieren", devServer: "Der Vite-Dev-Server unter {url} antwortet nicht. `pnpm dev` starten (der Web-Client läuft darin mit); Squorli lädt dann von selbst." },
  en: { checking: "Checking for updates …", downloading: "Downloading update {v} …", installing: "Installing update {v}. Squorli restarts in a moment.", starting: "Starting Squorli …", skip: "Install later", devServer: "The Vite dev server at {url} does not answer. Start `pnpm dev` (it runs the web client too); Squorli then loads by itself." },
};

/** What the start window shows for a step. The download can be skipped (it goes on in the background); nothing else can. */
export function splashView(s: SplashStep, german: boolean): SplashView {
  const t = german ? TEXTS.de : TEXTS.en;
  if (s.step === "downloading") return { text: t.downloading.replace("{v}", s.version), percent: Math.max(0, Math.min(100, Math.round(s.percent))), skip: t.skip };
  if (s.step === "installing") return { text: t.installing.replace("{v}", s.version), percent: 100, skip: null };
  if (s.step === "devServer") return { text: t.devServer.replace("{url}", s.url), percent: null, skip: null };
  return { text: s.step === "checking" ? t.checking : t.starting, percent: null, skip: null };
}

/**
 * Address of the page's only link, "install later". Nothing is ever loaded from it: the window refuses every navigation and
 * takes this one for the click. (A `#fragment` would not do: Chromium does not report a navigation inside a `data:` page;
 * measured on 20 September 2026, the click had no effect.)
 */
export const SPLASH_SKIP_URL = "app://squorli/__install-later";

/** `iconSvg` = the brand's icon mark (docs/brand/squorli-icon.svg, shipped with the client's files); null = no picture. */
export function splashHtml(iconSvg: string | null): string {
  const icon = iconSvg ? `<img alt="" src="data:image/svg+xml;base64,${Buffer.from(iconSvg, "utf8").toString("base64")}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Squorli</title><style>
html, body { margin: 0; height: 100%; background: #0a0f1e; color: #e8ecf6; font: 14px/1.4 "Segoe UI", system-ui, sans-serif; overflow: hidden; user-select: none; -webkit-app-region: drag; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 0 28px; box-sizing: border-box; text-align: center; }
img { width: 96px; height: 96px; }
h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.02em; }
#status { min-height: 2.8em; color: #aab3c8; }
#bar { width: 100%; height: 4px; border-radius: 2px; background: #1c2540; overflow: hidden; visibility: hidden; }
#fill { height: 100%; width: 0; background: #7aa2ff; transition: width 0.3s; }
#skip { color: #aab3c8; font-size: 12px; visibility: hidden; -webkit-app-region: no-drag; }
</style></head><body>${icon}<h1>Squorli</h1><div id="status"></div><div id="bar"><div id="fill"></div></div><a id="skip" href="${SPLASH_SKIP_URL}"></a></body></html>`;
}

/** The script the shell runs in the page to show a view (plain DOM writes, every text as a JSON string). */
export function splashScript(v: SplashView): string {
  return `(() => { const $ = (id) => document.getElementById(id);
$("status").textContent = ${JSON.stringify(v.text)};
$("bar").style.visibility = ${JSON.stringify(v.percent === null ? "hidden" : "visible")};
$("fill").style.width = ${JSON.stringify(`${v.percent ?? 0}%`)};
$("skip").textContent = ${JSON.stringify(v.skip ?? "")};
$("skip").style.visibility = ${JSON.stringify(v.skip === null ? "hidden" : "visible")}; })()`;
}

/**
 * An update that was handed to the installer at a start and is offered again at the next one did not install (the app
 * would otherwise run it by now). Trying again at every start would lock the user out of the app, so such a version is
 * installed at a start only once; after that it waits for "restart now" in the client or for the app to quit, as before.
 */
export function mayInstallAtStart(attempted: unknown, version: string): boolean {
  return attempted !== version;
}

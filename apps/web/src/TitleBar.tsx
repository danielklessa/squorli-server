import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { platform } from "./platform";
import { DOWNLOAD_URL, useUpdateState } from "./appUpdates";

/**
 * The desktop app's own title bar (user's wish, 18 September 2026): the window has no system frame, so this slim bar drags the
 * window (`-webkit-app-region: drag` in styles.css; a double click maximizes, as Windows does for a drag region) and carries
 * the three window buttons. Renders nothing in a browser (`platform.window.frame` is null) and in fullscreen.
 * When an update is downloaded it offers the restart (`onRestartForUpdate`: App.tsx asks first while in a voice channel);
 * a deb installation, which cannot update itself, gets the way to the download page instead.
 */
export function TitleBar({ title, onRestartForUpdate }: { title: string; onRestartForUpdate?: () => void }) {
  const frame = platform.window.frame;
  const update = useUpdateState();
  const [state, setState] = useState(() => frame?.state() ?? null);
  useEffect(() => frame?.subscribe(setState), [frame]);
  if (!frame || !state || state.fullscreen) return null;
  return (
    <header className={`titlebar ${state.focused ? "" : "inactive"}`}>
      <img className="titlebar-mark" src="/brand/squorli-icon-small.svg" alt="" width="16" height="16" />
      <span className="titlebar-title">{title}</span>
      {update?.status === "ready" && <button className="titlebar-update" title={t("update.ready", { v: update.version })} onClick={() => (onRestartForUpdate ?? (() => platform.updates?.restartAndInstall()))()}><Icon name="download" /> {t("update.restart")}</button>}
      {update?.status === "available" && update.manual && <button className="titlebar-update" title={t("update.availableManual", { v: update.version })} onClick={() => platform.links.openExternal(DOWNLOAD_URL)}><Icon name="download" /> {t("update.get", { v: update.version })}</button>}
      <div className="titlebar-buttons">
        <button className="titlebar-btn" title={t("window.minimize")} aria-label={t("window.minimize")} onClick={() => frame.control("minimize")}><Icon name="minus" /></button>
        <button className="titlebar-btn" title={state.maximized ? t("window.restore") : t("window.maximize")} aria-label={state.maximized ? t("window.restore") : t("window.maximize")} onClick={() => frame.control("toggle-maximize")}><Icon name={state.maximized ? "copy" : "square"} /></button>
        <button className="titlebar-btn close" title={t("common.close")} aria-label={t("common.close")} onClick={() => frame.control("close")}><Icon name="x" /></button>
      </div>
    </header>
  );
}

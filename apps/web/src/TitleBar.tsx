import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { platform } from "./platform";

/**
 * The desktop app's own title bar (user's wish, 18 September 2026): the window has no system frame, so this slim bar drags the
 * window (`-webkit-app-region: drag` in styles.css; a double click maximizes, as Windows does for a drag region) and carries
 * the three window buttons. Renders nothing in a browser (`platform.window.frame` is null) and in fullscreen.
 */
export function TitleBar({ title }: { title: string }) {
  const frame = platform.window.frame;
  const [state, setState] = useState(() => frame?.state() ?? null);
  useEffect(() => frame?.subscribe(setState), [frame]);
  if (!frame || !state || state.fullscreen) return null;
  return (
    <header className={`titlebar ${state.focused ? "" : "inactive"}`}>
      <img className="titlebar-mark" src="/brand/squorli-icon-small.svg" alt="" width="16" height="16" />
      <span className="titlebar-title">{title}</span>
      <div className="titlebar-buttons">
        <button className="titlebar-btn" title={t("window.minimize")} aria-label={t("window.minimize")} onClick={() => frame.control("minimize")}><Icon name="minus" /></button>
        <button className="titlebar-btn" title={state.maximized ? t("window.restore") : t("window.maximize")} aria-label={state.maximized ? t("window.restore") : t("window.maximize")} onClick={() => frame.control("toggle-maximize")}><Icon name={state.maximized ? "copy" : "square"} /></button>
        <button className="titlebar-btn close" title={t("common.close")} aria-label={t("common.close")} onClick={() => frame.control("close")}><Icon name="x" /></button>
      </div>
    </header>
  );
}

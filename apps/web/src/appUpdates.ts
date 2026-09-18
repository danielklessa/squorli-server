import { useEffect, useState } from "react";
import { locale, t } from "./i18n";
import { platform, type UpdateState } from "./platform";

/** Where the desktop app is downloaded (the website's page in the client's language). */
export const DOWNLOAD_URL = `https://squorli.com/${locale}/download/`;

/** The desktop app's update state, live; null in a browser and in an unpackaged app. */
export function useUpdateState(): UpdateState | null {
  const updates = platform.updates;
  const [state, setState] = useState<UpdateState | null>(() => updates?.get() ?? null);
  useEffect(() => updates?.subscribe(setState), [updates]);
  return state;
}

/** One sentence for the settings. */
export function describeUpdate(state: UpdateState): string {
  switch (state.status) {
    case "unsupported": return t("update.unsupported");
    case "idle": return state.checkedAt === null ? t("update.notChecked") : t("update.upToDate");
    case "checking": return t("update.checking");
    case "available": return t("update.availableManual", { v: state.version });
    case "downloading": return t("update.downloading", { v: state.version, n: state.percent });
    case "ready": return t("update.ready", { v: state.version });
    case "error": return t("update.error", { err: state.message });
  }
}

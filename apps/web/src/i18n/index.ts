import { de } from "./de";
import { en } from "./en";

/**
 * Client texts in German and English. The locale is fixed at page load: an explicit choice in localStorage wins,
 * otherwise the first browser language (navigator.languages) that we support, otherwise English (user decision,
 * 15 September 2026). Changing the choice reloads the page; the UI never has to re-render for a locale switch.
 */
export type Locale = "de" | "en";
export type Messages = typeof de;
export type MessageKey = keyof Messages;
export type LocalePreference = Locale | "auto";

export const LOCALES: readonly Locale[] = ["de", "en"];
const STORAGE_KEY = "chat.locale";
const CATALOGS: Record<Locale, Messages> = { de, en };

const isLocale = (v: unknown): v is Locale => v === "de" || v === "en";

/** The stored choice ("auto" = follow the browser). */
export function localePreference(): LocalePreference {
  try { const v = localStorage.getItem(STORAGE_KEY); return isLocale(v) ? v : "auto"; } catch { return "auto"; }
}

/** Store the choice without reloading (the store does that when the directory account's language arrives or after it pushed a change there). */
export function storeLocalePreference(pref: LocalePreference): void {
  try { if (pref === "auto") localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, pref); } catch { /* private mode or similar */ }
}

/** Store the choice and reload so that every text (including the ones computed once at module load) follows it. */
export function setLocalePreference(pref: LocalePreference): void {
  storeLocalePreference(pref);
  window.location.reload();
}

/**
 * The choice as the directory account last held it on this device (null = never in step). A local choice that differs from it
 * was made by the user since (e.g. in the login footer) and wins over the account's; otherwise the account's wins.
 */
const ACCOUNT_KEY = "chat.locale.account";
export function accountLocalePreference(): LocalePreference | null {
  try { const v = localStorage.getItem(ACCOUNT_KEY); return v === "auto" || isLocale(v) ? v : null; } catch { return null; }
}
export function markAccountLocalePreference(pref: LocalePreference | null): void {
  try { if (pref === null) localStorage.removeItem(ACCOUNT_KEY); else localStorage.setItem(ACCOUNT_KEY, pref); } catch { /* private mode or similar */ }
}

/** Browser language -> supported locale; English when none of the browser's languages is supported. */
export function localeFromBrowser(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const base = (lang ?? "").toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

export function detectLocale(): Locale {
  const pref = localePreference();
  return pref === "auto" ? localeFromBrowser(browserLanguages()) : pref;
}

export const locale: Locale = detectLocale();

/**
 * BCP 47 tag for dates and numbers: the browser's own tag when it belongs to the active locale (so "de-AT" or "en-GB"
 * keep their formats), otherwise the default region for the locale.
 */
export const localeTag: string = browserLanguages().find((l) => l.toLowerCase().split("-")[0] === locale) ?? (locale === "de" ? "de-DE" : "en-US");

/** Text for `key`; {name} placeholders are replaced from `params`. Unknown keys fall back to German, then to the key itself. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const s: string = CATALOGS[locale][key] ?? de[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Like t() for keys built at runtime (e.g. `conn.${state}`); falls back to `fallback` (default: the key) when unknown. */
export function tOr(key: string, fallback?: string): string {
  const s = (CATALOGS[locale] as Record<string, string>)[key] ?? (de as Record<string, string>)[key];
  return s ?? fallback ?? key;
}

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(localeTag, { dateStyle: "medium", timeStyle: "short" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(localeTag, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

/** Mark the document with the active language (screen readers, hyphenation, form controls). */
export function applyLocaleToDocument(): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

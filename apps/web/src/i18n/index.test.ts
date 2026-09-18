import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { APP_TEXTS, localeFromBrowser, lookupText, t } from "./index";

describe("i18n", () => {
  it("picks the first supported browser language, English otherwise", () => {
    expect(localeFromBrowser(["de-DE", "en-US"])).toBe("de");
    expect(localeFromBrowser(["en-GB", "de"])).toBe("en");
    expect(localeFromBrowser(["fr-FR", "de-AT"])).toBe("de");
    expect(localeFromBrowser(["fr-FR", "it"])).toBe("en");
    expect(localeFromBrowser([])).toBe("en");
  });

  it("has the same non-empty keys in both catalogs", () => {
    const dk = Object.keys(de).sort();
    const ek = Object.keys(en).sort();
    expect(ek).toEqual(dk);
    for (const k of dk) {
      expect((de as Record<string, string>)[k]!.length, k).toBeGreaterThan(0);
      expect((en as Record<string, string>)[k]!.length, k).toBeGreaterThan(0);
    }
  });

  it("uses the same placeholders in both languages", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(de) as (keyof typeof de)[]) expect(ph(en[k]), k).toEqual(ph(de[k]));
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(t("status.connecting", { host: "chat.example" })).toContain("chat.example");
    expect(t("status.connecting")).toContain("{host}");
  });
});

// The desktop app's wording ("this device" instead of "this browser"): app.de.ts, app.en.ts.
describe("texts of the desktop app", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

  it("covers the same keys in both languages, all of them keys of the catalog, with the catalog's placeholders", () => {
    expect(Object.keys(APP_TEXTS.en).sort()).toEqual(Object.keys(APP_TEXTS.de).sort());
    for (const lang of ["de", "en"] as const) {
      for (const [key, text] of Object.entries(APP_TEXTS[lang])) {
        const base = (lang === "de" ? de : en)[key as keyof typeof de];
        expect(base, key).toBeTypeOf("string");
        expect(placeholders(text), key).toBe(placeholders(base));
      }
    }
  });

  it("wins in the app only, and only for its keys", () => {
    expect(lookupText("lang.auto", "de", true)).toBe("Systemsprache");
    expect(lookupText("lang.auto", "de", false)).toBe("Browsersprache");
    expect(lookupText("settings.syncDevice", "en", true)).toBe("Saved on this device. With a directory account the settings apply on every server and device.");
    expect(lookupText("common.cancel", "de", true)).toBe(de["common.cancel"]);
    expect(lookupText("no.such.key", "en", true)).toBeUndefined();
  });
});

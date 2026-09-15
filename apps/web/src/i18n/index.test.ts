import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { localeFromBrowser, t } from "./index";

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

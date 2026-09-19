import { describe, expect, it } from "vitest";
import { webAppManifest, webAppName } from "./webManifest";

describe("web app manifest", () => {
  it("offers 'Squorli - <server name>' as the name, and plain 'Squorli' without one", () => {
    expect(webAppName("Test Server")).toBe("Squorli - Test Server");
    expect(webAppName("  ")).toBe("Squorli");
    expect(webAppName(null)).toBe("Squorli");
    const m = webAppManifest("Test Server");
    expect(m.name).toBe("Squorli - Test Server");
    expect(m.short_name).toBe(m.name);
  });

  it("names the Squorli icons, one of them maskable, and opens as an app on the brand's ground", () => {
    const m = webAppManifest(null);
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#0C1424");
    expect(m.icons.map((i) => i.purpose)).toEqual(["any", "any", "maskable"]);
    expect(m.icons.every((i) => /^\/app-icons\/[a-z0-9-]+\.png\?v=\d+$/.test(i.src) && i.type === "image/png")).toBe(true);
  });
});

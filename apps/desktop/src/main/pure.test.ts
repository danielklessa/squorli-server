import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, contentTypeOf, resolveAppFile } from "./appFiles";
import { normalizeAppearance, supportedMaterials } from "./appearance";
import { findDeepLink } from "./deepLinkArgs";
import { isAllowedExternal, windowOpenDecision } from "./navigation";
import { desktopUserAgent } from "./userAgent";

const root = join(sep === "\\" ? "C:\\app" : "/app", "renderer");

describe("resolveAppFile", () => {
  it("serves files, and index.html for the client's routes", () => {
    expect(resolveAppFile(root, "/")).toBe(join(root, "index.html"));
    expect(resolveAppFile(root, "/invite/abcdef")).toBe(join(root, "index.html"));
    expect(resolveAppFile(root, "/assets/main-abc.js")).toBe(join(root, "assets", "main-abc.js"));
    expect(resolveAppFile(root, "/player-window.html")).toBe(join(root, "player-window.html"));
    expect(resolveAppFile(root, "/brand/squorli%2Dicon.svg")).toBe(join(root, "brand", "squorli-icon.svg"));
  });
  it("never leaves the root", () => {
    for (const path of ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt", "/..%2f..%2fsecret.txt", "/assets\\..\\..\\x.txt", "/%00.js", "/%E0%A4%A"]) expect(resolveAppFile(root, path), path).toBeNull();
  });
});

describe("contentTypeOf", () => {
  it("knows what the client ships", () => {
    expect(contentTypeOf("index.html")).toContain("text/html");
    expect(contentTypeOf("a/main.JS")).toContain("text/javascript");
    expect(contentTypeOf("font.woff2")).toBe("font/woff2");
    expect(contentTypeOf("unknown.bin")).toBe("application/octet-stream");
  });
});

describe("CONTENT_SECURITY_POLICY", () => {
  it("keeps scripts to the app and the blur's WASM host, frames to the two players", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net;");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src https://player.twitch.tv https://www.youtube-nocookie.com;");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });
});

describe("desktopUserAgent", () => {
  const electron = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Squorli/0.1.0 Chrome/140.0.0.0 Electron/44.4.2 Safari/537.36";
  it("replaces Electron's app token and keeps Chrome", () => {
    expect(desktopUserAgent(electron, "1.2.3")).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Squorli-Desktop/1.2.3 Chrome/140.0.0.0 Electron/44.4.2 Safari/537.36");
  });
  it("works without an app token and with an odd default", () => {
    expect(desktopUserAgent(electron.replace("Squorli/0.1.0 ", ""), "1.2.3")).toContain("(KHTML, like Gecko) Squorli-Desktop/1.2.3 Chrome/140");
    expect(desktopUserAgent("Something/1.0", "1.2.3")).toBe("Something/1.0 Squorli-Desktop/1.2.3");
  });
});

describe("appearance", () => {
  it("offers materials on Windows 11 22H2 and later only", () => {
    expect(supportedMaterials("win32", "10.0.26200")).toEqual(["mica", "acrylic"]);
    expect(supportedMaterials("win32", "10.0.22621")).toEqual(["mica", "acrylic"]);
    expect(supportedMaterials("win32", "10.0.19045")).toEqual([]);
    expect(supportedMaterials("linux", "6.8.0")).toEqual([]);
  });
  it("turns whatever was stored into a valid appearance", () => {
    const all = supportedMaterials("win32", "10.0.26200");
    expect(normalizeAppearance({ material: "acrylic", opacity: 0.75 }, all)).toEqual({ material: "acrylic", opacity: 0.75 });
    expect(normalizeAppearance({ material: "acrylic", opacity: 0.1 }, all)).toEqual({ material: "acrylic", opacity: 0.4 });
    expect(normalizeAppearance({ material: "acrylic", opacity: 7 }, [])).toEqual({ material: "none", opacity: 1 });
    expect(normalizeAppearance({ material: "tabbed", opacity: "x" }, all)).toEqual({ material: "none", opacity: 1 });
    for (const v of [null, undefined, 5, "acrylic", []]) expect(normalizeAppearance(v, all)).toEqual({ material: "none", opacity: 1 });
  });
});

describe("findDeepLink", () => {
  it("finds the link among the arguments the system passes", () => {
    expect(findDeepLink(["C:/Users/someone/AppData/Local/Programs/Squorli/Squorli.exe", "--allow-file-access-from-files", "--","squorli://invite/chat.example.org/abcdef"])).toBe("squorli://invite/chat.example.org/abcdef");
    expect(findDeepLink(["squorli", "SQUORLI://server/Chat.Example.org"])).toBe("SQUORLI://server/Chat.Example.org");
  });
  it("ignores everything that is no valid link", () => {
    expect(findDeepLink(["Squorli.exe", "--dev-url=http://evil.example", "squorli://server/evil.example --inspect=0.0.0.0:9229", "squorli://open/x", "https://chat.example.org"])).toBeNull();
    expect(findDeepLink([])).toBeNull();
  });
});

describe("navigation", () => {
  const origins = ["app://squorli"];
  it("opens only the client's own windows", () => {
    expect(windowOpenDecision("about:blank", origins)).toBe("allow");
    expect(windowOpenDecision("app://squorli/player-window.html?src=x", origins)).toBe("allow");
    expect(windowOpenDecision("app://squorli/other.html", origins)).toBe("deny");
    expect(windowOpenDecision("https://example.org/", origins)).toBe("external");
    expect(windowOpenDecision("mailto:someone@example.org", origins)).toBe("external");
    for (const url of ["file:///C:/Windows/system32/calc.exe", "javascript:alert(1)", "smb://host/share", "squorli://server/x.example", "app://evil/player-window.html", "not a url"]) expect(windowOpenDecision(url, origins), url).toBe("deny");
  });
  it("hands only web and mail addresses to the system", () => {
    expect(isAllowedExternal("https://squorli.com/de/download/")).toBe(true);
    expect(isAllowedExternal("http://localhost:3100/")).toBe(true);
    expect(isAllowedExternal("mailto:a@example.org")).toBe(true);
    for (const url of ["file:///etc/passwd", "ms-settings:privacy", "javascript:alert(1)", "", "C:\\Windows\\system32\\calc.exe"]) expect(isAllowedExternal(url), url).toBe(false);
  });
});

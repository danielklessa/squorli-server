import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, contentTypeOf, resolveAppFile } from "./appFiles";
import { appearanceState, normalizeAppearance, supportedMaterials } from "./appearance";
import { hwndOfHandle, hwndOfSource } from "./captureSource";
import { findDeepLink } from "./deepLinkArgs";
import { isAllowedExternal, windowOpenDecision } from "./navigation";
import { updateMode } from "./updateMode";
import { desktopUserAgent } from "./userAgent";
import { restoreWindowState } from "./windowState";

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
  it("offers mica on Windows 11 22H2 and later, a see-through window on Windows and Linux", () => {
    expect(supportedMaterials("win32", "10.0.26200")).toEqual(["mica", "clear"]);
    expect(supportedMaterials("win32", "10.0.22621")).toEqual(["mica", "clear"]);
    expect(supportedMaterials("win32", "10.0.19045")).toEqual(["clear"]);
    expect(supportedMaterials("linux", "6.8.0")).toEqual(["clear"]);
    expect(supportedMaterials("darwin", "24.0.0")).toEqual([]);
  });
  it("turns whatever was stored into a valid appearance", () => {
    const all = supportedMaterials("win32", "10.0.26200");
    expect(normalizeAppearance({ material: "clear", opacity: 0.75 }, all)).toEqual({ material: "clear", opacity: 0.75 });
    expect(normalizeAppearance({ material: "mica", opacity: 0.1 }, all)).toEqual({ material: "mica", opacity: 0.4 });
    expect(normalizeAppearance({ material: "mica", opacity: 7 }, ["clear"])).toEqual({ material: "none", opacity: 1 });
    expect(normalizeAppearance({ material: "acrylic", opacity: "x" }, all)).toEqual({ material: "none", opacity: 1 });
    for (const v of [null, undefined, 5, "clear", []]) expect(normalizeAppearance(v, all)).toEqual({ material: "none", opacity: 1 });
  });
  it("knows what the running window shows and when a restart is pending", () => {
    expect(appearanceState({ material: "mica", opacity: 0.8 }, false, "none")).toEqual({ appearance: { material: "mica", opacity: 0.8 }, effective: "mica", needsRestart: false });
    expect(appearanceState({ material: "clear", opacity: 0.8 }, false, "mica")).toEqual({ appearance: { material: "clear", opacity: 0.8 }, effective: "mica", needsRestart: true });
    expect(appearanceState({ material: "clear", opacity: 0.8 }, true, "clear")).toEqual({ appearance: { material: "clear", opacity: 0.8 }, effective: "clear", needsRestart: false });
    expect(appearanceState({ material: "none", opacity: 1 }, true, "clear")).toEqual({ appearance: { material: "none", opacity: 1 }, effective: "clear", needsRestart: true });
  });
});

describe("restoreWindowState", () => {
  const main = { x: 0, y: 0, width: 1920, height: 1040 }, left = { x: -2560, y: 0, width: 2560, height: 1400 };
  it("reopens where the window was, also on a display left of the main one", () => {
    expect(restoreWindowState({ bounds: { x: 100, y: 80, width: 1300, height: 800 }, maximized: false }, [main])).toEqual({ bounds: { x: 100, y: 80, width: 1300, height: 800 }, maximized: false });
    expect(restoreWindowState({ bounds: { x: -2000, y: 200, width: 1300, height: 800 }, maximized: true }, [main, left])).toEqual({ bounds: { x: -2000, y: 200, width: 1300, height: 800 }, maximized: true });
  });
  it("falls back to the default place when the display is gone or the title bar would be out of reach", () => {
    expect(restoreWindowState({ bounds: { x: -2000, y: 200, width: 1300, height: 800 } }, [main])).toBeNull();
    expect(restoreWindowState({ bounds: { x: 100, y: -400, width: 1300, height: 800 } }, [main])).toBeNull();
    expect(restoreWindowState({ bounds: { x: 1900, y: 100, width: 1300, height: 800 } }, [main])).toBeNull();
  });
  it("clamps the size to the display and survives rubbish", () => {
    expect(restoreWindowState({ bounds: { x: 0, y: 0, width: 5000, height: 100 } }, [main])).toEqual({ bounds: { x: 0, y: 0, width: 1920, height: 480 }, maximized: false });
    for (const v of [null, undefined, 3, "x", {}, { bounds: { x: "1", y: 0, width: 1, height: 1 } }, { bounds: { x: NaN, y: 0, width: 800, height: 600 } }]) expect(restoreWindowState(v, [main])).toBeNull();
  });
});

describe("updateMode", () => {
  it("updates itself on Windows and as an AppImage, by hand as a deb, never unpackaged", () => {
    expect(updateMode({ packaged: true, platform: "win32", appImage: false })).toBe("self");
    expect(updateMode({ packaged: true, platform: "linux", appImage: true })).toBe("self");
    expect(updateMode({ packaged: true, platform: "linux", appImage: false })).toBe("manual");
    expect(updateMode({ packaged: true, platform: "darwin", appImage: false })).toBe("none");
    expect(updateMode({ packaged: false, platform: "win32", appImage: false })).toBe("none");
  });
});

describe("captureSource", () => {
  it("reads the window handle of a source id and of Electron's handle buffer", () => {
    expect(hwndOfSource("window:1312345:0")).toBe("1312345");
    expect(hwndOfSource("screen:0:0")).toBeNull();
    for (const id of ["window:abc:0", "window:12", "window:1 --x:0", ""]) expect(hwndOfSource(id), id).toBeNull();
    expect(hwndOfHandle(Uint8Array.from([0x59, 0x06, 0x14, 0x00, 0, 0, 0, 0]))).toBe(String(0x140659));
    expect(hwndOfHandle(Uint8Array.from([0x39, 0x30, 0, 0]))).toBe("12345");
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

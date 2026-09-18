import { describe, expect, it } from "vitest";
import { deepLinkServerUrl, formatDeepLink, parseDeepLink } from "./deepLink";

describe("parseDeepLink", () => {
  it("reads a server link", () => {
    expect(parseDeepLink("squorli://server/chat.example.org")).toEqual({ kind: "server", host: "chat.example.org" });
    expect(parseDeepLink("squorli://server/chat.example.org/")).toEqual({ kind: "server", host: "chat.example.org" });
    expect(parseDeepLink("  SQUORLI://Server/Chat.Example.org ")).toEqual({ kind: "server", host: "chat.example.org" });
  });

  it("reads an invite link", () => {
    expect(parseDeepLink("squorli://invite/chat.example.org/AbC_12-x")).toEqual({ kind: "invite", host: "chat.example.org", code: "AbC_12-x" });
  });

  it("accepts a port, also percent-encoded", () => {
    expect(parseDeepLink("squorli://server/localhost:3000")).toEqual({ kind: "server", host: "localhost:3000" });
    expect(parseDeepLink("squorli://server/localhost%3A3000")).toEqual({ kind: "server", host: "localhost:3000" });
  });

  it("accepts the form without slashes that some launchers hand over", () => {
    expect(parseDeepLink("squorli:server/chat.example.org")).toEqual({ kind: "server", host: "chat.example.org" });
  });

  it("round-trips through formatDeepLink", () => {
    for (const raw of ["squorli://server/chat.example.org", "squorli://invite/chat.example.org:8443/abcdef"]) expect(formatDeepLink(parseDeepLink(raw)!)).toBe(raw);
  });

  it("refuses everything else", () => {
    const hostile = [
      "", "squorli://", "squorli://server", "squorli://server/", "https://chat.example.org", "squorli://open/chat.example.org",
      "squorli://server/chat.example.org/extra", "squorli://server/chat.example.org?x=1", "squorli://server/chat.example.org#x",
      "squorli://server/user@evil.example", "squorli://server/evil.example%2Fpath", "squorli://server/evil.example%5Cpath",
      "squorli://server/-bad.example", "squorli://server/a..b", "squorli://server/%E0%A4%A", "squorli://server/ex ample.org",
      "squorli://invite/chat.example.org", "squorli://invite/chat.example.org/abc", "squorli://invite/chat.example.org/abc$defg",
      "squorli://invite/chat.example.org/abcdef/more", "squorli://server/chat.example.org --inspect=9229",
      `squorli://server/${"a".repeat(500)}.example`,
    ];
    for (const raw of hostile) expect(parseDeepLink(raw), raw).toBeNull();
    expect(parseDeepLink(undefined as unknown as string)).toBeNull();
  });
});

describe("deepLinkServerUrl", () => {
  it("is https except for localhost", () => {
    expect(deepLinkServerUrl({ kind: "server", host: "chat.example.org" })).toBe("https://chat.example.org");
    expect(deepLinkServerUrl({ kind: "server", host: "localhost:3000" })).toBe("http://localhost:3000");
  });
});

import { describe, expect, it } from "vitest";
import { connectedHost } from "./serverHost";

describe("connectedHost (the domain a foreign sign-in signs)", () => {
  it("is the host of the address actually connected to, with a port only where it is not the default", () => {
    expect(connectedHost("https://Chat.Example.org")).toBe("chat.example.org");
    expect(connectedHost("https://chat.example.org:443")).toBe("chat.example.org");
    expect(connectedHost("http://localhost:3199")).toBe("localhost:3199");
    expect(connectedHost("not a url")).toBe("");
  });
});

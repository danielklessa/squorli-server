import Fastify from "fastify";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { redactUrl, requestSerializer } from "./logRedact";

describe("redactUrl", () => {
  it("hides the secret parameters and keeps everything else", () => {
    expect(redactUrl("/api/status?key=abc&x=1")).toBe("/api/status?key=***&x=1");
    expect(redactUrl("/api/attachments/u/n.png?e=123&s=deadbeef")).toBe("/api/attachments/u/n.png?e=123&s=***");
    expect(redactUrl("/api/keys/k?nonce=n&sig=ff&KEY=x")).toBe("/api/keys/k?nonce=n&sig=***&KEY=***");
    expect(redactUrl("/api/health")).toBe("/api/health");
    expect(redactUrl("/x?s")).toBe("/x?s");
  });
  it("reaches Fastify's request log", async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
    const app = Fastify({ logger: { level: "info", stream, serializers: { req: requestSerializer } } });
    app.get("/api/status", async () => ({ ok: true }));
    await app.inject({ method: "GET", url: "/api/status?key=supersecret" });
    await app.close();
    const log = lines.join("");
    expect(log).toContain("key=***");
    expect(log).not.toContain("supersecret");
  });
});

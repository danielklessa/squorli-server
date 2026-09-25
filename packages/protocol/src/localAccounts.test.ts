import { describe, expect, it } from "vitest";
import { displayNameOf } from "./index";
import { LocalHandle, LocalRegisterRequest, handleLabel, localRegisterMessage, parseLoginName } from "./localAccounts";

describe("handleLabel", () => {
  it("prefers the directory handle", () => {
    expect(handleLabel({ handle: "anna", localHandle: "anna2" })).toBe("@anna");
    expect(handleLabel({ handle: null, localHandle: "anna" })).toBe("~anna");
    expect(handleLabel({ handle: null, localHandle: null })).toBeNull();
    expect(handleLabel({})).toBeNull();
  });
});

describe("displayNameOf", () => {
  it("falls back from the name to @handle, ~handle, then the key", () => {
    const pk = "ab".repeat(32);
    expect(displayNameOf({ displayName: "Anna", publicKey: pk, handle: "a", localHandle: "b" })).toBe("Anna");
    expect(displayNameOf({ displayName: null, publicKey: pk, handle: "a", localHandle: "b" })).toBe("@a");
    expect(displayNameOf({ displayName: null, publicKey: pk, handle: null, localHandle: "b" })).toBe("~b");
    expect(displayNameOf({ displayName: null, publicKey: pk })).toBe("anon-ababab");
  });
});

describe("parseLoginName", () => {
  it("lets the prefix decide", () => {
    expect(parseLoginName("@Anna", false)).toEqual({ kind: "directory", name: "anna" });
    expect(parseLoginName(" ~anna ", true)).toEqual({ kind: "local", name: "anna" });
  });
  it("falls back to the directory when there is one", () => {
    expect(parseLoginName("anna", true)).toEqual({ kind: "directory", name: "anna" });
    expect(parseLoginName("anna", false)).toEqual({ kind: "local", name: "anna" });
    expect(parseLoginName("", false)).toEqual({ kind: "local", name: "" });
  });
});

describe("schemas", () => {
  it("uses the directory's handle rules", () => {
    expect(LocalHandle.parse(" Anna.B ")).toBe("anna.b");
    expect(() => LocalHandle.parse("~anna")).toThrow();
    expect(() => LocalHandle.parse("ab")).toThrow();
  });
  it("binds the registration to domain, nonce, handle and ciphertext", () => {
    expect(localRegisterMessage("chat.example.org", "n", "anna", "Y3Q=")).toBe("squorli-local-register\nchat.example.org\nn\nanna\nY3Q=");
  });
  it("parses a registration", () => {
    const r = LocalRegisterRequest.safeParse({
      challengeId: "00000000-0000-4000-8000-000000000000", publicKey: "ab".repeat(32), signature: "cd".repeat(64), handle: "anna",
      backup: { ciphertext: "Y3Q=", params: { kdf: "pbkdf2-sha256", iterations: 600_000, salt: "00".repeat(16), iv: "00".repeat(12) }, authKey: "ef".repeat(32) },
    });
    expect(r.success).toBe(true);
  });
});

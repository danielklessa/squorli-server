import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SETTINGS_MAX_LENGTH, AccountSettings, AccountSettingsUpdateRequest, DirectoryHealth, DirectoryRegisterRequest, Handle, directoryRegisterMessage, parseAccountSettings,
} from "./directory";

describe("registration", () => {
  const base = { publicKey: "a".repeat(64), challengeId: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc", signature: "b".repeat(128) };
  it("accepts handles by the rules only", () => {
    expect(Handle.parse("  Daniel.K_1 ")).toBe("daniel.k_1");
    for (const bad of ["ab", "Nicht Erlaubt!", ".dot", "dash-ed", "x".repeat(33)]) expect(Handle.safeParse(bad).success).toBe(false);
  });
  it("signs the message of before without an address and covers the address when there is one", () => {
    expect(directoryRegisterMessage("id.example.org", "daniel", "n1")).toBe("community-directory-register\nid.example.org\ndaniel\nn1");
    expect(directoryRegisterMessage("id.example.org", "daniel", "n1", "d@example.org")).toBe("community-directory-register\nid.example.org\ndaniel\nn1\nd@example.org");
  });
  it("takes an optional address (lowercased) and an 8-digit code", () => {
    expect(DirectoryRegisterRequest.parse({ ...base, handle: "daniel" }).email).toBeUndefined();
    expect(DirectoryRegisterRequest.parse({ ...base, handle: "daniel", email: " Daniel@Example.ORG " }).email).toBe("daniel@example.org");
    expect(DirectoryRegisterRequest.safeParse({ ...base, handle: "daniel", email: "no-address" }).success).toBe(false);
    expect(DirectoryRegisterRequest.safeParse({ ...base, handle: "daniel", email: "d@example.org", emailCode: "1234567" }).success).toBe(false);
    expect(DirectoryRegisterRequest.parse({ ...base, handle: "daniel", email: "d@example.org", emailCode: "12345678" }).emailCode).toBe("12345678");
  });
  it("reads emailRequired as false from a directory that predates it", () => {
    const h = DirectoryHealth.parse({ ok: true, service: "directory", host: "id.example.org", features: { backup: true, totp: true, email: true }, time: new Date().toISOString() });
    expect(h.features.emailRequired).toBe(false);
  });
});

describe("account settings", () => {
  it("fills every field from an empty object", () => {
    expect(AccountSettings.parse({})).toEqual({
      locale: "auto",
      voice: { mode: "vad", pttKey: "Space", vadThreshold: 0.04, vadHangoverMs: 400 },
      camera: { quality: "720p", blur: 0 },
      sounds: { selfJoin: true, selfLeave: true, peerJoin: true, peerLeave: true, volume: 0.6 },
      stage: { featureSelf: true },
    });
  });
  it("keeps what an older client stored and defaults the rest", () => {
    const s = AccountSettings.parse({ locale: "de", voice: { mode: "ptt" } });
    expect(s.locale).toBe("de");
    expect(s.voice).toEqual({ mode: "ptt", pttKey: "Space", vadThreshold: 0.04, vadHangoverMs: 400 });
    expect(s.stage.featureSelf).toBe(true);
  });
  it("rejects values outside the ranges", () => {
    expect(AccountSettings.safeParse({ voice: { vadThreshold: 2 } }).success).toBe(false);
    expect(AccountSettings.safeParse({ locale: "fr" }).success).toBe(false);
    expect(AccountSettings.safeParse({ sounds: { selfJoin: true } }).success).toBe(false);
  });
  it("parses a stored string and survives rubbish", () => {
    expect(parseAccountSettings(JSON.stringify({ stage: { featureSelf: false } }))?.stage.featureSelf).toBe(false);
    expect(parseAccountSettings("{nope")).toBeNull();
    expect(parseAccountSettings(JSON.stringify({ locale: 5 }))).toBeNull();
    expect(parseAccountSettings(null)).toBeNull();
  });
  it("limits the length of the signed string", () => {
    const base = { publicKey: "a".repeat(64), challengeId: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc", signature: "b".repeat(128) };
    expect(AccountSettingsUpdateRequest.safeParse({ ...base, settings: "{}" }).success).toBe(true);
    expect(AccountSettingsUpdateRequest.safeParse({ ...base, settings: "x".repeat(ACCOUNT_SETTINGS_MAX_LENGTH + 1) }).success).toBe(false);
  });
});

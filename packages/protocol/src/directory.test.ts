import { describe, expect, it } from "vitest";
import { DirectoryGame, LibraryGameId, directoryGameIconUrl, directoryGameUrl, splitGameId } from "./directory";
import {
  ACCOUNT_SETTINGS_MAX_LENGTH, AVATAR_MAX_BYTES, AccountSettings, AccountSettingsUpdateRequest, AvatarUpdateRequest, DirectoryAccount, DirectoryHealth, avatarDigest, directoryAvatarPayload, directoryAvatarUrl, sniffAvatarMime, DirectoryRegisterRequest, Handle, directoryRegisterMessage, parseAccountSettings,
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
    // The message cue (20 September 2026) is optional: settings stored before it stay valid and say nothing about it.
    expect(AccountSettings.parse({}).sounds.message).toBeUndefined();
    expect(AccountSettings.parse({ sounds: { selfJoin: true, selfLeave: true, peerJoin: true, peerLeave: true, message: false, volume: 0.6 } }).sounds.message).toBe(false);
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

describe("avatars", () => {
  const base = { publicKey: "a".repeat(64), challengeId: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc", signature: "b".repeat(128) };
  it("recognizes PNG, JPEG and WebP by their first bytes and nothing else", () => {
    expect(sniffAvatarMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffAvatarMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffAvatarMime(new TextEncoder().encode("RIFF0000WEBPVP8 "))).toBe("image/webp");
    for (const bad of ["GIF89a", "<svg xmlns=", "RIFF0000WAVEfmt ", ""]) expect(sniffAvatarMime(new TextEncoder().encode(bad))).toBeNull();
  });
  it("signs type and digest, and nothing for a removal", async () => {
    expect(await avatarDigest(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(directoryAvatarPayload("image/webp", "ab12")).toBe("image/webp\nab12");
    expect(directoryAvatarPayload(null, null)).toBe("");
  });
  it("takes base64 up to the size limit, null to remove, and no other type", () => {
    expect(AvatarUpdateRequest.parse({ ...base, avatar: null }).avatar).toBeNull();
    expect(AvatarUpdateRequest.safeParse({ ...base, avatar: { mime: "image/png", data: "iVBORw0KGgo=" } }).success).toBe(true);
    expect(AvatarUpdateRequest.safeParse({ ...base, avatar: { mime: "image/gif", data: "R0lGODlh" } }).success).toBe(false);
    expect(AvatarUpdateRequest.safeParse({ ...base, avatar: { mime: "image/png", data: "not base64!" } }).success).toBe(false);
    expect(AvatarUpdateRequest.safeParse({ ...base, avatar: { mime: "image/png", data: "A".repeat(Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 4) } }).success).toBe(false);
  });
  it("builds the address with the cache version and none without an avatar", () => {
    expect(directoryAvatarUrl("https://id.example.org/", "a".repeat(64), "2026-09-19T10:00:00.000Z")).toBe(`https://id.example.org/api/avatars/${"a".repeat(64)}?v=${Date.parse("2026-09-19T10:00:00.000Z")}`);
    expect(directoryAvatarUrl("https://id.example.org", "a".repeat(64), null)).toBeNull();
    expect(DirectoryAccount.parse({ handle: "daniel", publicKey: "a".repeat(64), createdAt: "2026-09-19T10:00:00.000Z" }).avatarUpdatedAt).toBeNull();
    expect(DirectoryHealth.parse({ ok: true, service: "directory", host: "h", features: { backup: true, totp: true, email: false }, time: "2026-09-19T10:00:00.000Z" }).features.avatars).toBe(false);
  });
});

describe("game library", () => {
  it("takes the launchers' ids and nothing else", () => {
    for (const id of ["steam:730", "steam:1133870", "gog:1207658924", "xbox:9NHFVWX1V7QJ"]) expect(LibraryGameId.safeParse(id).success).toBe(true);
    for (const id of ["steam:0730", "steam:", "steam:7 30", "epic:Sugar", "custom:d:\\a.exe", "xbox:9nhfvwx1v7qj", "xbox:9NHFVWX1V7QJ/../x", "STEAM:730", "steam:12345678901", ""]) expect(LibraryGameId.safeParse(id).success).toBe(false);
    expect(splitGameId("steam:730")).toEqual({ source: "steam", key: "730" });
  });

  it("builds the addresses, the icon's only when there is one", () => {
    expect(directoryGameUrl("https://directory.example/", "steam:730")).toBe("https://directory.example/api/games/steam%3A730");
    expect(directoryGameIconUrl("https://directory.example", { id: "steam:730", iconUpdatedAt: "2026-09-21T10:00:00.000Z" })).toBe(`https://directory.example/api/games/steam%3A730/icon?v=${Date.parse("2026-09-21T10:00:00.000Z")}`);
    expect(directoryGameIconUrl("https://directory.example", { id: "steam:730", iconUpdatedAt: null })).toBeNull();
    expect(DirectoryGame.safeParse({ id: "steam:730", name: "Counter-Strike 2", show: true, iconUpdatedAt: null }).success).toBe(true);
  });
});

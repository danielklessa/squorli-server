import { AccountSettings } from "@squorli/protocol";
import { describe, expect, it } from "vitest";
import { applyAccountSettings, sameAccountSettings, toAccountSettings } from "./accountSettings";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "./voice/settings";

const device: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS, inputDeviceId: "mic-1", outputDeviceId: "out-1", screenOutputDeviceId: "out-2", cameraDeviceId: "cam-1" };

describe("account settings", () => {
  it("leaves the device selection out of the account", () => {
    const s = toAccountSettings(device, "de");
    expect(JSON.stringify(s)).not.toContain("mic-1");
    expect(JSON.stringify(s)).not.toContain("cam-1");
    expect(AccountSettings.parse(s)).toEqual(s);
  });

  it("matches the protocol defaults for a fresh device", () => {
    expect(sameAccountSettings(toAccountSettings(DEFAULT_VOICE_SETTINGS, "auto"), AccountSettings.parse({}))).toBe(true);
  });

  it("applies the account's settings and keeps the devices", () => {
    const remote = AccountSettings.parse({ voice: { mode: "ptt", pttKey: "KeyV" }, camera: { quality: "360p", blur: 20 }, stage: { featureSelf: false }, sounds: { selfJoin: false, selfLeave: true, peerJoin: true, peerLeave: false, volume: 0.2 } });
    const next = applyAccountSettings(device, remote);
    expect(next.mode).toBe("ptt");
    expect(next.pttKey).toBe("KeyV");
    expect(next.cameraQuality).toBe("360p");
    expect(next.cameraBlur).toBe(20);
    expect(next.featureSelfInSpeakerView).toBe(false);
    expect(next.sounds.volume).toBe(0.2);
    expect([next.inputDeviceId, next.outputDeviceId, next.screenOutputDeviceId, next.cameraDeviceId]).toEqual(["mic-1", "out-1", "out-2", "cam-1"]);
    expect(sameAccountSettings(toAccountSettings(next, "auto"), remote)).toBe(true);
  });

  it("notices every difference, whatever the key order", () => {
    const a = toAccountSettings(DEFAULT_VOICE_SETTINGS, "auto");
    expect(sameAccountSettings(a, { stage: a.stage, sounds: a.sounds, camera: a.camera, voice: a.voice, locale: a.locale })).toBe(true);
    expect(sameAccountSettings(a, { ...a, locale: "en" })).toBe(false);
    expect(sameAccountSettings(a, { ...a, stage: { featureSelf: false } })).toBe(false);
    expect(sameAccountSettings(a, { ...a, voice: { ...a.voice, vadHangoverMs: 450 } })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_SETTINGS } from "./sounds";
import { DEFAULT_VOICE_SETTINGS, loadVoiceSettings, sameSoundSettings, saveVoiceSettings, subscribeVoiceSettings, type VoiceSettingsSource } from "./settings";

describe("voice settings", () => {
  it("falls back to the defaults without localStorage", () => {
    expect(loadVoiceSettings()).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("tells subscribers who saved (the user pushes to the account, the account does not echo)", () => {
    const seen: VoiceSettingsSource[] = [];
    const off = subscribeVoiceSettings((_s, source) => { seen.push(source); });
    saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, sounds: { ...DEFAULT_SOUND_SETTINGS, peerJoin: false } });
    saveVoiceSettings(DEFAULT_VOICE_SETTINGS, "directory");
    off();
    saveVoiceSettings(DEFAULT_VOICE_SETTINGS);
    expect(seen).toEqual(["user", "directory"]);
    expect(loadVoiceSettings()).toBe(DEFAULT_VOICE_SETTINGS);
  });

  it("compares cue settings field by field", () => {
    expect(sameSoundSettings(DEFAULT_SOUND_SETTINGS, { ...DEFAULT_SOUND_SETTINGS })).toBe(true);
    expect(sameSoundSettings(DEFAULT_SOUND_SETTINGS, { ...DEFAULT_SOUND_SETTINGS, volume: 0.5 })).toBe(false);
    expect(sameSoundSettings(DEFAULT_SOUND_SETTINGS, { ...DEFAULT_SOUND_SETTINGS, selfLeave: false })).toBe(false);
  });
});

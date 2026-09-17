/**
 * Settings that follow the directory account (protocol `AccountSettings`): everything the user can set in the client except the
 * device selection (microphone, outputs, camera: device ids belong to one browser). The per-device copy in localStorage
 * (voice/settings.ts, i18n `chat.locale`) stays the working copy, so servers without a directory keep working; store.ts applies the
 * account's copy on load and pushes user changes. Pure functions, no storage access.
 */
import type { AccountSettings } from "@squorli/protocol";
import type { LocalePreference } from "./i18n";
import type { VoiceSettings } from "./voice/settings";

/** The part of this device's settings that belongs to the account. */
export function toAccountSettings(s: VoiceSettings, locale: LocalePreference): AccountSettings {
  return {
    locale,
    voice: { mode: s.mode, pttKey: s.pttKey, vadThreshold: s.vadThreshold, vadHangoverMs: s.vadHangoverMs },
    camera: { quality: s.cameraQuality, blur: s.cameraBlur },
    sounds: { selfJoin: s.sounds.selfJoin, selfLeave: s.sounds.selfLeave, peerJoin: s.sounds.peerJoin, peerLeave: s.sounds.peerLeave, volume: s.sounds.volume },
    stage: { featureSelf: s.featureSelfInSpeakerView },
  };
}

/** The account's settings on top of this device's; the device selection stays as it is. The locale is handled by the caller (it needs a reload). */
export function applyAccountSettings(local: VoiceSettings, remote: AccountSettings): VoiceSettings {
  return {
    ...local,
    mode: remote.voice.mode, pttKey: remote.voice.pttKey, vadThreshold: remote.voice.vadThreshold, vadHangoverMs: remote.voice.vadHangoverMs,
    cameraQuality: remote.camera.quality, cameraBlur: remote.camera.blur,
    sounds: { ...remote.sounds },
    featureSelfInSpeakerView: remote.stage.featureSelf,
  };
}

/** Same settings? Compared in a fixed field order, so the key order of a parsed object does not matter. */
export function sameAccountSettings(a: AccountSettings, b: AccountSettings): boolean {
  const canon = (s: AccountSettings) => JSON.stringify([
    s.locale, s.voice.mode, s.voice.pttKey, s.voice.vadThreshold, s.voice.vadHangoverMs, s.camera.quality, s.camera.blur,
    s.sounds.selfJoin, s.sounds.selfLeave, s.sounds.peerJoin, s.sounds.peerLeave, s.sounds.volume, s.stage.featureSelf,
  ]);
  return canon(a) === canon(b);
}

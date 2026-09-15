/**
 * Voice settings per device (PLAN 3.5: "the user chooses per device"). Stored in localStorage.
 */
export type VoiceMode = "vad" | "ptt";

export type VoiceSettings = {
  mode: VoiceMode;
  /** KeyboardEvent.code, e.g. "Space" or "KeyV". */
  pttKey: string;
  /** Threshold for voice activation, 0..1 (RMS level). */
  vadThreshold: number;
  /** Hangover time in ms so that word endings are not cut off. */
  vadHangoverMs: number;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** Separate output device for screen share audio (null = same as voice). Chromium only (setSinkId). */
  screenOutputDeviceId: string | null;
  cameraDeviceId: string | null;
  /** Send resolution of the camera (simulcast supplies smaller layers automatically). */
  cameraQuality: "360p" | "720p";
  /** Camera background blur: 0 = off, otherwise the radius (10 light, 20 strong). Only in browsers that support it. */
  cameraBlur: number;
};

const KEY = "chat.voice.v1";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  mode: "vad", // Default per the plan: works without explanation
  pttKey: "Space",
  vadThreshold: 0.04,
  vadHangoverMs: 400,
  inputDeviceId: null,
  outputDeviceId: null,
  screenOutputDeviceId: null,
  cameraDeviceId: null,
  cameraQuality: "720p",
  cameraBlur: 0,
};

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    return { ...DEFAULT_VOICE_SETTINGS, ...(JSON.parse(raw) as Partial<VoiceSettings>) };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode or similar: then simply not */ }
}

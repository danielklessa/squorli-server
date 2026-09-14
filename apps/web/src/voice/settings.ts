/**
 * Sprach-Einstellungen pro Geraet (PLAN 3.5: "Nutzer waehlt pro Geraet"). Liegen im localStorage.
 */
export type VoiceMode = "vad" | "ptt";

export type VoiceSettings = {
  mode: VoiceMode;
  /** KeyboardEvent.code, z. B. "Space" oder "KeyV". */
  pttKey: string;
  /** Schwelle fuer Sprachaktivierung, 0..1 (RMS-Pegel). */
  vadThreshold: number;
  /** Nachlaufzeit in ms, damit Wortenden nicht abgeschnitten werden. */
  vadHangoverMs: number;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** Eigenes Ausgabegeraet fuer den Ton von Bildschirmfreigaben (null = wie Sprache). Nur Chromium (setSinkId). */
  screenOutputDeviceId: string | null;
  cameraDeviceId: string | null;
  /** Sendeaufloesung der Kamera (Simulcast liefert kleinere Stufen automatisch mit). */
  cameraQuality: "360p" | "720p";
  /** Hintergrund-Unschaerfe der Kamera: 0 = aus, sonst Radius (10 leicht, 20 stark). Nur in Browsern mit Unterstuetzung. */
  cameraBlur: number;
};

const KEY = "chat.voice.v1";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  mode: "vad", // Standard laut Plan: funktioniert ohne Erklaerung
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
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* privater Modus o. ae.: dann eben nicht */ }
}

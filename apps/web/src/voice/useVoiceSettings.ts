import { useSyncExternalStore } from "react";
import { loadVoiceSettings, subscribeVoiceSettings, type VoiceSettings } from "./settings";

/** The current voice settings as React state shared by every component (App, VoiceDock); `saveVoiceSettings` updates all of them. */
export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(subscribeVoiceSettings, loadVoiceSettings, loadVoiceSettings);
}

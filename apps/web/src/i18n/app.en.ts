import type { de } from "./de";

/** Texts that read differently in the desktop app; see `app.de.ts`. */
export const appEn: Partial<Record<keyof typeof de, string>> = {
  "lang.auto": "System language",
  "login.replaceKeyText": "@{handle} is already set up on this device. Signing in with an account replaces that key.",
  "login.replaceKeyTextNoBackup": "@{handle} is already set up on this device. Signing in with an account replaces that key, and it has no password backup yet. Without a backup it will be gone.",
  "profile.forgetText": "The key is deleted from this device. Without a password backup at the directory the account cannot be restored afterwards.",
  "profile.languageHint": "Without a choice the system language decides; English when it is not supported. Changing it reloads the app.",
  "camera.noBlur": "Background effects are not available on this device.",
  "dock.unblockAudioHint": "Playback is blocked until you click",
  "dock.unblockMicHint": "The audio context is paused; a click releases the microphone and the speaker indicator",
  "settings.syncDevice": "Saved on this device. With a directory account the settings apply on every server and device.",
  "settings.devicesLocal": "The device selection applies to this device only.",
  "settings.pttHint": "Only while a Squorli window has focus. A global hotkey is planned.",
  "settings.blurHint": "Computed on this device (MediaPipe); costs some CPU. The model is loaded the first time it is turned on.",
  "settings.noBlur": "Background effects are not available on this device.",
  "stage.fullscreenUnavailable": "Fullscreen is not available here.",
  "stage.popupBlocked": "The window could not be opened. Please try again.",
  "radio.soundBlocked": "The player may not start with sound right now. Click anywhere in the window and it plays with sound.",
  "admin.radio.httpHint": "The app and many browsers (on an https page) do not play http:// addresses. Use https:// where possible.",
  "dir.no_backup": "There is no password backup for this handle. Create it where the handle was registered (browser or app): \"Set password\" in the login.",
  "voice.connErrWs": "{message}. The LiveKit address \"{url}\" uses ws:// (unencrypted); the app blocks that, like a browser on an HTTPS page. Switch LIVEKIT_PUBLIC_URL to wss://.",
  "voice.errMic": "Microphone: {err}. Check that a microphone is connected, that Squorli may use it in the system's privacy settings, and that the right one is chosen under Settings > Audio devices.",
  "voice.errCameraBusy": "Camera: {err}. The camera could not be started: another program is using it, or it has not been released yet. Close other programs with camera access and try again.",
};

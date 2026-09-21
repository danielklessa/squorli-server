import type { de } from "./de";

/**
 * Texts that read differently in the desktop app: the German catalog talks about "this browser", "this tab", "the page",
 * which the app is not (user's reports, 18 September 2026). Only the keys that differ; `t()` takes them first while
 * running in the app (index.ts). Same keys as `app.en.ts` and the same placeholders as the catalog (index.test.ts).
 */
export const appDe: Partial<Record<keyof typeof de, string>> = {
  "login.createDirectoryHint": "Öffnet das Verzeichnis {host} in deinem Browser. Erstelle dort dein Konto und melde dich anschließend hier in der App an.",
  "login.localHint": "Du brauchst weder Benutzername noch Passwort oder E-Mail-Adresse. Dein Zugang wird auf diesem Gerät gespeichert. Löschst du die App-Daten oder wechselst das Gerät, kannst du diesen Zugang ohne Sicherung nicht wiederherstellen.",
  "login.savedHint": "Dein Konto ist auf diesem Gerät gespeichert. Du kannst dich direkt verbinden, ohne dein Passwort erneut einzugeben.",
  "lang.auto": "Systemsprache",
  "login.replaceKeyText": "Auf diesem Gerät ist bereits @{handle} eingerichtet. Die Anmeldung mit einem Konto ersetzt diesen Schlüssel.",
  "login.replaceKeyTextNoBackup": "Auf diesem Gerät ist bereits @{handle} eingerichtet. Die Anmeldung mit einem Konto ersetzt diesen Schlüssel, und er hat noch kein Passwort-Backup. Ohne Backup ist er danach weg.",
  "profile.forgetText": "Der Schlüssel wird von diesem Gerät gelöscht. Ohne Passwort-Backup beim Verzeichnis ist das Konto danach nicht wiederherstellbar.",
  "profile.languageHint": "Ohne Auswahl entscheidet die Systemsprache; Englisch, wenn sie nicht unterstützt wird. Ein Wechsel lädt die App neu.",
  "camera.noBlur": "Hintergrund-Effekte sind auf diesem Gerät nicht verfügbar.",
  "dock.unblockAudioHint": "Die Wiedergabe ist bis zu einem Klick blockiert",
  "dock.unblockMicHint": "Der Audio-Kontext ist angehalten; Klick gibt Mikrofon und Sprecheranzeige frei",
  "settings.syncDevice": "Gespeichert auf diesem Gerät. Mit einem Konto beim Verzeichnis gelten die Einstellungen auf allen Servern und Geräten.",
  "settings.devicesLocal": "Die Geräteauswahl gilt nur für dieses Gerät.",
  "settings.pttHint": "Nur solange ein Squorli-Fenster den Fokus hat. Ein globales Tastenkürzel ist geplant.",
  "settings.blurHint": "Rechnet auf diesem Gerät (MediaPipe); kostet etwas CPU. Modell wird beim ersten Einschalten geladen.",
  "settings.noBlur": "Hintergrund-Effekte sind auf diesem Gerät nicht verfügbar.",
  "stage.fullscreenUnavailable": "Vollbild ist hier nicht verfügbar.",
  "stage.popupBlocked": "Das Fenster konnte nicht geöffnet werden. Bitte erneut versuchen.",
  "radio.soundBlocked": "Der Player darf gerade nicht mit Ton starten. Klicke irgendwo ins Fenster, dann läuft er mit Ton.",
  "admin.radio.httpHint": "Adressen mit http:// spielen die App und viele Browser (auf einer https-Seite) nicht ab. Wenn möglich https:// verwenden.",
  "dir.no_backup": "Für dieses Handle gibt es kein Passwort-Backup. Lege es dort an, wo das Handle registriert wurde (Browser oder App): „Passwort festlegen“ im Login.",
  "voice.connErrWs": "{message}. Die LiveKit-Adresse \"{url}\" läuft über ws:// (unverschlüsselt); die App blockiert das, wie ein Browser auf einer HTTPS-Seite. LIVEKIT_PUBLIC_URL auf wss:// umstellen.",
  "voice.errMic": "Mikrofon: {err}. Prüfen, ob ein Mikrofon angeschlossen ist, Squorli in den Datenschutz-Einstellungen des Systems darauf zugreifen darf und unter Einstellungen > Sprache und Audio das richtige gewählt ist.",
  "voice.errCameraBusy": "Kamera: {err}. Die Kamera ließ sich nicht starten: Sie wird gerade von einem anderen Programm benutzt oder wurde noch nicht wieder freigegeben. Andere Programme mit Kamerazugriff schließen und es noch einmal versuchen.",
  "settings.screenAudioHint": "Ton geteilter Bildschirme getrennt ausgeben, z. B. auf die Lautsprecher statt ins Headset. Gilt in der App auch für YouTube-Videos im Chat (wenige Sekunden nach dem Start des Videos).",
  "settings.radioAudioHint": "Das Radio eines Sprachkanals getrennt ausgeben, z. B. auf die Lautsprecher statt ins Headset. Gilt in der App auch für Twitch- und YouTube-Quellen (wenige Sekunden nach dem Start des Players).",
};

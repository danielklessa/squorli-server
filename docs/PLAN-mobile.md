# Plan: a native client for Android, later iOS

Part of the project description (entry point: root `AGENTS.md`, section 0; open work `docs/PLAN.md` 3.5). Written on 25 September 2026 after the user's question "was müsste man für einen nativen Client für Android (später auch iOS) machen?"; the user asked for the answer as a plan file first. Nothing is built yet. **The six decisions of section 6 were made by the user on 25 September 2026** (plan cleanup; priority: medium, after the report function, `docs/PLAN.md` 3.5). Other proposals in the text are still Claude's.

Mobile clients left the list "not planned for now" of `docs/PLAN.md` on 25 September 2026.

## 1. What exists already

- **One build, several shells** (`docs/features/desktop.md`, user's decision of 18 September 2026): the desktop app is an Electron shell around `apps/web/dist`, served from `app://squorli`; every difference goes through the `Platform` interface in `apps/web/src/platform/` (`types.ts`, `bridge.ts`, `desktop.ts`, `web.ts`). A mobile shell would be the third implementation of that interface.
- **The client without a home server** (`docs/features/desktop.md`, P1): the app starts from the directory account and opens the server viewed last. A mobile app needs exactly that.
- **Phones in the browser** (19 September 2026): `platform/mobile.ts` recognises a phone or tablet; the microphone boost, the voice defaults and the unmirrored rear camera follow from it (`voice/micBoost.ts`, `voice/settings.ts`, `videoDisplay.ts`). `App.tsx` has a narrow layout by window width; `MobileVoicePreview.tsx` exists. The home screen manifest: `docs/features/home-screen.md`.
- **What the client keeps in localStorage:** the identity (`chat.identity.v1`, `identity.ts`), the keys of server accounts (`chat.serverAccounts.v1`, `docs/features/local-accounts.md`), per-device settings. The sealed settings' key is derived from the identity's seed (`deriveSettingsKey`).
- **Two WebSockets per client:** one per chat server (`serverConnection.ts`), one to the directory (`directoryLink.ts`) for friends, presence and the end-to-end encrypted direct messages.
- **The UI-free shared core planned in 2026 was never split off:** state, protocol client and voice logic live in `apps/web/src` next to the React components (`store.ts`, `voice/`). That matters for option B below.

## 2. Which way (proposal: A)

| Option | What is reused | Assessment |
|---|---|---|
| **A. Capacitor shell** around `apps/web/dist` (new `apps/mobile`), native pieces as plugins | the whole client: UI, store, protocol, voice core with `livekit-client` | Fits the one-build decision; a UI change reaches browser, desktop and phone at once. The open question is voice in the background (section 3.2). |
| B. React Native | the logic, after it has been moved out of `apps/web` into a package | The UI is written a second time and drifts from the web client's; a big move of code first. |
| C. Fully native (Kotlin, Swift) | the protocol's rules only (by hand, no zod) | Three clients for one developer. Rejected. |

**Proposal (Claude's, not confirmed): A**, with a hybrid on iOS if the prototype shows the web view cannot carry voice there: the UI stays in the web view, voice runs in a native plugin on LiveKit's Swift SDK. Tauri 2 mobile is a candidate for the shell too; it is younger than Capacitor for exactly this (WebRTC permissions in the web view, background services), which is an assessment, not a measurement.

## 3. Work that any way needs

### 3.1 Push notifications (the largest architectural question)

- In the background the WebSockets die: iOS suspends the app within seconds, Android kills it sooner or later. Without push nothing arrives while the app is closed.
- FCM (Android) and APNs (iOS) need credentials of the app's **publisher**. A self-hosted chat server cannot have them. So **the directory would relay**: a chat server tells the directory "something new for account X on server Y" (a new server-to-directory call next to `DirectoryNotifyRequest`), the directory sends it on through FCM/APNs to the account's registered devices.
- Content: as little as possible. Proposal: no plain text in the push; the push wakes the app or carries a count, the app fetches the rest itself. iOS shows a notification only with visible text or a Notification Service Extension that decrypts; for direct messages (already end-to-end encrypted, already via the directory) such an extension could open the message on the device.
- New in the directory: a table of device tokens per account (with platform, app version, last seen), registration and removal by a signed account action, rate limits per server, and the directory's own FCM service account and APNs key.
- New on the chat server: when to push (mentions, direct replies, channels with "all messages"; mutes and read states from `docs/features/mentions-unread.md` apply), only for accounts of the directory. **Server accounts (`~name`) get no push** through this path, as they have no directory account (same limit as their direct messages).
- Optional later: UnifiedPush for phones without Google services and an F-Droid build.
- Privacy: this is a new data flow (which server has news for which account, device tokens at Google and Apple). It belongs in the privacy statement (the Impressum/Datenschutz task in the workspace root, `LEGAL_DATENVERARBEITUNG.md`).

### 3.2 Voice in the background, audio session

- **Android:** a foreground service of type `microphone` (and `mediaPlayback` for listening only) while the user sits in a voice channel, with a standing notification (channel name, mute, deafen, leave). Audio focus, earpiece vs. speaker vs. Bluetooth headset, interruption by a phone call. Whether Chromium's WebView keeps WebRTC running with the screen off while such a service holds the process is **not checked**; that is the first thing the prototype measures.
- **iOS:** background mode `audio` (or `voip`), an `AVAudioSession` of our own (play-and-record, Bluetooth, speaker). WebRTC in WKWebView exists since iOS 14.3, but audio stops when the app goes to the background and the web view offers no audio routing: most likely voice has to run natively there (option A's hybrid). CallKit is optional (it would make a voice channel look like a phone call; not available in China).
- **After returning to the front:** reconnect both WebSockets, fetch what was missed, rejoin LiveKit if the room dropped. The client does part of this already (reconnect with backoff); the phone makes it the normal case, not the exception.

### 3.3 Keys and sign-in

- Move the identity, the server account keys and the seed out of localStorage into the Android Keystore / iOS Keychain (a secure storage plugin behind the `Platform` interface). The desktop app has the same point open (`safeStorage`, `docs/features/desktop.md`); one interface for both.
- The app needs a fixed origin like `app://squorli` (Capacitor: a custom scheme on iOS, `https://localhost` or a custom host on Android). Check: CORS of the chat servers and the directory for that origin, the sign domain of the challenge sign-in, cookies if any. The origin is final once a public version exists, as on the desktop (the key sits in its storage until 3.3 is done).

### 3.4 Platform functions

- **Links:** `squorli://` plus App Links (Android) and Universal Links (iOS) for `https://squorli.com/...` invite links. That needs `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` on squorli.com, which belong in the website's `public/` (the deploy deletes hand-placed files).
- **Screen share:** Android through MediaProjection (with its foreground service type `mediaProjection`), feasible. iOS needs a Broadcast Upload Extension, a project of its own; proposal: leave it out at first.
- **Camera front/rear, badge count** (`platform.window.attention`), notifications: into the existing interface.
- **Desktop-only functions** (game detection, global hotkeys, the system watch helper, window material, tray, autostart, updates of the shell): the mobile platform reports them as unavailable, as the browser does.
- **UI:** safe areas (`viewport-fit=cover`, which `home-screen.md` avoided on purpose), Android's back button (close modal, then back to the channel list), the on-screen keyboard over the message input, touch targets, long press where the desktop has a right click (context menus, `VoiceMemberMenu`, the member menu). Push-to-talk as a button exists (`PushToTalkButton.tsx`).

### 3.5 Versions and releases

- The client is packed into the app and store updates take days: new apps must work with older servers and the other way round for longer than today. The `PROTOCOL_VERSION` rule (`packages/protocol/AGENTS.md`) and optional fields with defaults become more important, not less.
- A tag scheme of its own (`mobile-v<semver>`), release notes like the desktop's, a skill like `desktop-release`.
- Loading a newer web bundle over the air (Capacitor live updates) is possible on Android; Apple allows it only for JavaScript without new native features. Proposal: not at first.

## 4. Stores and law

- **Apple, guideline 1.2 (user-generated content):** an app needs a way to report content and to block users, and a way to act on reports. Squorli has **no report function yet** (being built first, `docs/PLAN-reports.md`, decided 25 September 2026). This is a likely reason for rejection on iOS; Google Play has a similar rule. A self-hosted network of servers whose content the publisher does not moderate makes the review conversation harder. Decided: the report function comes first (section 6, decision 4). The plan for it: `docs/PLAN-reports.md`.
- Account deletion inside the app (Apple 5.1.1(v)): exists (directory account page, server accounts in the settings); it has to be reachable in the app.
- Privacy forms in both stores (Google's data safety, Apple's privacy labels), the privacy statement (see 3.1).
- Apple's export question about encryption (`ITSAppUsesNonExemptEncryption`): the direct messages are end-to-end encrypted with standard algorithms; to be declared.
- Accounts and tools: Google Play (one-off fee, an identity check for new developer accounts), Apple Developer Program (yearly fee), a Mac or macOS runners in CI for iOS builds and signing.
- License: the app is part of the Apache 2.0 repository; the plugins' licenses go into the licenses list (`docs/features/licenses.md`).

## 5. Stages

0. **Prototype Android (2 to 3 days):** a Capacitor shell around `apps/web/dist`, sign in, join a voice channel, put the app in the background, turn the screen off, measure whether sound goes both ways for 30 minutes; with and without a foreground service. Result decides between the web view's voice and a native voice plugin on Android.
1. **Android shell:** `apps/mobile`, the mobile `Platform` implementation, keys in the Keystore, links, foreground service with its notification, the UI points of 3.4, an internal test build in Google Play.
2. **Push through the directory:** protocol, directory table and relay, the chat server's trigger rules; direct messages and mentions first.
3. **iOS prototype:** voice in WKWebView in the background; most likely a native LiveKit plugin follows. At the same time decide the report function (section 4).
4. **Store releases** Android, then iOS.
5. Later: screen share on Android, then iOS; UnifiedPush/F-Droid; live updates.

## 6. Decisions (made by the user on 25 September 2026)

1. Shell: Capacitor around `apps/web/dist` (option A; on iOS voice may move into a native plugin if the prototype says so).
2. Push content: only a wake-up or a count, no plain text at Google or Apple; for direct messages a decrypting extension on iOS later.
3. Server accounts (`~name`) get no push.
4. The report and block function is built first (`docs/PLAN-reports.md`, all its decisions made the same day).
5. Android alone first, iOS afterwards.
6. No screen share on the phone in the first version.

## 7. Not checked

Everything above is reading and knowledge of the platforms, nothing was run: WebRTC in Android's WebView in the background, WKWebView's audio in the background, Capacitor's handling of the microphone permission, the store rules' current wording, the fees.

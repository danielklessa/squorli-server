# Feature notes: Status API and the server-wide mute display

Part of the project description (entry point: root `AGENTS.md`, section 0). Dated entries: what was built, the user's wishes and decisions, consequences, and what was and was not checked. Standing rules live in the `AGENTS.md` of the area. Whoever changes the feature adds or updates its entry here in the same step.

Code: protocol `StatusApiMode`, `ServerSettings.statusApi`, `StatusApiKeyResponse`, `ServerStatus` (`StatusChannel`, `StatusMember`), `VoiceStatus`, `VoiceMember.micMuted`/`deafened`, `ClientVoiceJoin.micMuted`/`deafened`, `ClientVoiceStatus` (all in `packages/protocol/src/index.ts`); server `routes/status.ts` (GET /api/status), `routes/settings.ts` (the mode in PATCH /api/settings, GET/POST /api/settings/status-api-key), `voice/presence.ts` (`setStatus`, `statusOfUser`), `ws/handler.ts` (`voice.status`), `config.ts` (`publicOrigin`), schema `server_settings.status_api`/`status_api_key` (migration 0025; 0026 drops the `members.share_avatar` column 0025 had added, see below); client `AdminPanel.tsx` (`StatusApiSection`), `Sidebar.tsx` (mute icons from `VoiceMember`), `App.tsx` (the `voice.status` effect), `serverConnection.ts` (remembers the state for the re-join).

## Built (23 September 2026, user's wish)

The wish: "Ich hätte gerne für den Server, dass es eine API gibt die die Raumstruktur und die Clients anzeigen kann. Standard ist deaktiviert, der Server Admin kann sich entscheiden einen API Key darauf zu legen oder die API öffentlich zu machen. Es soll abrufbar sein: Servername, Server Logo, Liste aller Räume mit Reihenfolge, Liste aller Benutzer, der Räume in denen sie sind und ob sie gemuted sind und oder ihre Ausgabe gemuted haben. Von den Clients auch die Avatarbilder wenn der Benutzer sie mit dem Server teilt (oder eine extra Freigabe dafür). Die Anzeige wer gemuted ist / seinen Ton gemuted hat soll auf dem Server auch immer sichtbar sein, nicht nur wenn man sich im selben Raum befindet."

### The route

`GET /api/status` answers JSON (`ServerStatus`):

- `name`, `iconUrl` (absolute, `<publicOrigin>/api/server-icon?v=<version>`, null without an icon), `time`.
- `categories` in the client's order (position, then name), `channels` flat and in the client's order (position, then creation) with `id`, `kind`, `name`, `topic`, `categoryId` (null = outside every category, those come first in the client) and `position`. Consumers group by `categoryId`; nothing is nested, so the shape mirrors `ServerState`.
- `members`: every member (join order) with `userId`, `displayName`, `handle`, `avatarUrl` (the directory account's picture, as the member list shows it), `online`, `afk`, `isOwner` and `voice` (`{ channelId, micMuted, deafened, cameraOn, screenOn }` or null; camera and screen since the same day, user's wish: "Im UI möchte ich auch sehen können wenn ich nicht im Kanal bin wer das Mikro gemuted hat, die Lautsprecher gemuted hat und oder webcam oder screen share macht"). `?online=1` leaves out the members who are not signed in. Never the public key, roles, permissions or messages.
- Modes (`server_settings.status_api`, Verwaltung > Server, `PATCH /api/settings { statusApi }` with MANAGE_SERVER): `off` (default) answers 404 `status_api_off`; `key` needs the server's key as `Authorization: Bearer <key>` or `?key=<key>` (401 otherwise, compared in constant time); `public` answers anyone. The key is 32 random bytes as base64url, made the first time the mode is switched to `key`, kept over later switches, fetched with `GET /api/settings/status-api-key` and replaced with `POST /api/settings/status-api-key` (both MANAGE_SERVER; the key is never part of `ServerSettings`, which every member gets). CORS is open like for every route (a widget on another site can fetch it), `cache-control: no-store`, and the server keeps one answer for a second so a widget on a busy page does not turn into a query per visitor.
- `publicOrigin` in `config.ts` (`https://PUBLIC_DOMAIN`, `http://localhost:PORT` in dev) is where the absolute addresses point; `directoryProofUrl` is derived from it now.

### Avatars: no extra consent (user's decision)

The wish had asked for the avatars "wenn der Benutzer sie mit dem Server teilt (oder eine extra Freigabe dafür)". A first version had a tick per server under Einstellungen > Profil (`members.share_avatar`, `PUT /api/me/share-avatar`, `Me.shareAvatar`, migration 0025 added the column). The user then decided the same day: "der Avatar ist ohnehin öffentlich und auch so beschrieben, wir benötigen also kein extra Recht dafür" (the settings' avatar text says it is public like the handle). So the status API shows `avatarUrl` for every member who has one, the tick, the route and the field went again, and migration 0026 drops the column (0025 had already run on the dev databases, so it was not rewritten).

### Mute, sound off, camera and screen share for the whole server

Until now the sidebar showed the microphone and headphone icons only for people in the same LiveKit room (LiveKit's `isMicrophoneEnabled` and the attribute `deafened`). Now every client tells the chat server: `voice.join` carries `micMuted`/`deafened`/`cameraOn`/`screenOn` (so nobody shows as unmuted for a moment; the AFK channel shows as both), `voice.status` follows on every change while connected (`App.tsx` effect on `voice.micMuted`/`voice.deafened`/`voice.cameraOn`/`voice.screenOn`), and `serverConnection.ts` remembers the last state and says it again with the join after a reconnect. The server keeps it per connection in `VoicePresence` and broadcasts `voice.state` with `VoiceMember.micMuted`/`deafened`/`cameraOn`/`screenOn` on a change only. The sidebar prefers LiveKit's state for the room the viewer is in (media state, at once) and falls back to the member's reported state for every other channel, for all four icons (microphone, headphones, camera, screen). Push-to-talk and voice activation are not "muted": what is reported is the dock's mute button and "Ton aus", the same as the icons showed before.

Compatibility: no `PROTOCOL_VERSION` bump. `VoiceMember` defaults the four fields (`VoiceStatus` defaults camera and screen too, so a client that reports only the mute state still parses) (an older server sends none, the client then shows what LiveKit gives it, as before), an older server drops the join's extra fields unread, and `voice.status` is sent only to a server whose settings carry `statusApi` (the feature flag of both; an older server would answer `bad_message`). An older client on a new server simply reports nothing and shows as unmuted to the others outside its room.

### Not built, open

- No rate limit on the route beyond the one-second cache; a public API on a busy server is the admin's choice.
- No env variable to pin the mode at deployment (the admin area decides; `REQUIRE_ACCOUNT` has such a pin, this one could get one on request).
- The website's documentation (`../squorli-website`) does not mention the API yet.
- The mobile join sheet (`MobileVoicePreview`) still lists names only, without the mute icons.

Checked: `docs/VERIFIED-STATE.md` of the same date.

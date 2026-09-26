# Feature notes: reports on a chat server, the moderation log, deleting on ban

Part of the project description (entry point: root `AGENTS.md`, section 0). Dated entries: what was built, the user's wishes and decisions, consequences, and what was and was not checked. Standing rules live in the `AGENTS.md` of the area. Whoever changes the feature adds or updates its entry here in the same step. The plan with the seven decisions and the later stages: `docs/PLAN-reports.md`.

Code: protocol `packages/protocol/src/reports.ts` (`ReportReason`, `CreateReportRequest`, `Report`, `ReportSnapshot`, `CloseReportRequest`, `DeleteRecentHours`, `ModLogEntry`, retention constants), `permissions.ts` (`MANAGE_REPORTS`), `index.ts` (`BanRequest.deleteMessagesHours`, `ServerState.openReports`, events `reports.count`, `message.bulkDelete`, `moderation.notice`); server `src/reports.ts` (`ReportsService`: snapshots, queue, close, files, retention), `src/modLog.ts` (`recordModLog`, `listModLog`, `sweepModLog`, `userNameOf`), `src/moderation.ts` (`deleteRecentMessagesOf`), `src/routes/reports.ts`, the log calls in `routes/messages.ts`, `routes/members.ts` (ban with the delete choice), `routes/channelBlocks.ts`, `state.ts` (`openReports`), tables `reports` and `mod_log` (migration 0035), migration 0036 (the permission backfill), `rateLimits.ts` (`tokenReports`); client `ReportDialog.tsx`, `ReportsTab.tsx` (Verwaltung > Meldungen and the log; `askDeleteRecentHours`), `askSelect` in `dialogs.tsx`, the flag in `ChatView.tsx`'s message actions and in `MemberList.tsx`'s server section, the `reports` badge of `ServerRail.tsx`, the three events in `serverConnection.ts`, the `report.*` texts.

## Built (26 September 2026): stages 1 and 2 of `docs/PLAN-reports.md`

The user made all seven decisions on 25 September 2026 (plan section 9) and asked on 26 September 2026 to tackle the feature. Built are stage 1 (server reports) and stage 2 (delete on ban, the moderation log). Stages 3 (blocking members in the sealed settings), 4 (reports to the directory: direct messages, accounts, whole servers, passed-on reports) and 5 (push while offline) are open; the plan keeps them.

### Reporting

- **Who and what:** every member may report a message they can see (not their own; an invisible channel's message is a 404 as everywhere) or a member. Reason from the fixed list (`spam`, `harassment`, `hate`, `sexual`, `violence`, `illegal`, `other`) plus a free text up to 1000 characters. One open report per member and message (409 `already_reported`), 10 reports per member and hour (`tokenReports`). `POST /api/reports`.
- **The snapshot:** the message's text, its author (name, handle, avatar address at that moment), time, the previews' texts, and **copies of the attachment files** under `DATA_DIR/reports/<reportId>/<n>`, apart from ordinary attachments and reachable only through the report's own signed links (`/api/reports/:id/files/:n/:name?e&s`, the same HMAC as attachment links with the id `report/<id>/<n>`, the same inline rule and sandbox). A member report keeps name, handle and avatar address. So the report stays reviewable after the message is gone or the person left.
- **The queue (Verwaltung > Meldungen, `MANAGE_REPORTS`):** open reports newest first with the snapshot, whether the message still exists, the reporter, and how many earlier reports exist about the same person; the closed ones on request (the last 200). Actions close a report with their result: delete the message (the server does it, `MANAGE_REPORTS` suffices for a reported message; every other open report about that message closes with it), delete the person's messages of the last hour, day or week, kick, ban (both through their own routes with their own rights and rank rules, then recorded), dismiss. `POST /api/reports/:id/close`.
- **The count:** `ServerState.openReports` (the number for a member with `MANAGE_REPORTS`, 0 for everybody else; the field's presence is the feature flag for "Melden") and the event `reports.count` on every change to every online moderator. The rail shows an amber badge with the number (on the current server too), the admin panel's tab a badge. Nothing while offline (decision 5): the count comes with the next welcome.
- **The reported person** never learns who reported. When a moderator deletes their message through the queue, or their recent messages, they get `moderation.notice` (decision 4): the reason and the channel, no name; the client shows it as a notice dialog. Only while online: the server keeps no notices (a limitation of stage 1, noted in the plan).
- **Retention (decision 3):** an hourly sweep sets the snapshot to null and removes the files 30 days after closing, 90 days after the report at the latest; the row stays, so repeats about the same person keep counting. The reporter's account deletion takes their reports along (FK cascade); the reported person's deletion leaves the snapshot with the user reference null (it is evidence about them).
- **Permission:** `MANAGE_REPORTS` (bit 18, "Meldungen bearbeiten"), server-wide, in the role editor's group "Mitglieder" after kick and ban; migration 0036 grants it to every role with `MANAGE_MESSAGES` (decision 7); owners and administrators have it anyway.

### Deleting on ban and the moderation log (stage 2)

- **Ban:** `BanRequest.deleteMessagesHours` (1, 24 or 168) deletes the member's messages of that window in every channel with their attachment files, one `message.bulkDelete` per channel instead of single events (older clients drop the event and catch up on reload; no version bump, `packages/protocol/AGENTS.md`). The member menu asks for it after the reason (`askSelect`), the report queue's ban too.
- **The log (`mod_log`, decision 2):** who did what to whom, when, where, without message contents: deleting somebody else's message (own deletions are nobody's business), kick, ban (with reason and the delete choice), unban, a moderator's channel block and its lifting (the vote kick's block is the members' own doing and not logged), and every closed report with its result. Names are kept as text so a line stays readable after an account is gone. `GET /api/mod-log?before=<iso>` with `MANAGE_REPORTS`, 100 per page, newest first; shown below the queue. Rows older than 180 days go (a sweep every 6 hours).

### Protocol

No `PROTOCOL_VERSION` bump: the new events reach only moderators (`reports.count`) or are safe to miss (`message.bulkDelete`, `moderation.notice`); `openReports` is optional; the new permission bit is no incompatible change; `BanRequest`'s new field is optional. New error codes went on REST answers only (`own_message`, `already_reported`, `already_closed`, `no_message`, `no_member`).

### Decisions made by Claude, not confirmed by the user

- The snapshot copies attachment files but only the texts of link previews (title, description, site name, address), not the preview pictures: the picture is a copy of a public page's image, the address stays in the snapshot.
- Channel blocks are not offered as an action in the queue (they concern voice channels; a reported message is in a text channel); kick and ban are.
- Deleting a reported message through the queue needs `MANAGE_REPORTS` only, not `MANAGE_MESSAGES` in that channel (the migration gives moderators both anyway).
- The notice to the reported person is a dialog shown only while they are online; the server keeps no notices.
- The report queue lists reports about channels the moderator cannot see themselves (one server-wide list, as the plan says); the snapshot is what they judge by.
- The rail badge for open reports is amber and shows on the current server too (a moderator should notice it), the mention badge's rules stay.
- Sizes: 200 reports per list, 100 log lines per page, one hourly and one six-hourly sweep.

## Not checked

- The dialog, the queue, the badges and the notice on screen (typecheck, unit tests and the smoke test only; no screenshot yet).
- Two real clients: the notice arriving at the reported person, the bulk delete disappearing from an open channel, the badge updating live.
- The retention sweep with real dates (the SQL only), the log sweep.
- The website's administrator guide does not describe the queue yet (`../squorli-website/docs/PLAN.md`).

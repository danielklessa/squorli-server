-- Reports (26 September 2026, docs/features/reports.md; decision 7 of the user on 25 September 2026): the new right
-- MANAGE_REPORTS (bit 18 = 262144) goes to every role that may delete other people's messages today (MANAGE_MESSAGES,
-- bit 9 = 512). Owners and administrators have it anyway. Nothing else changes for existing servers.
UPDATE "roles" SET "permissions" = "permissions" | 262144 WHERE ("permissions" & 512) <> 0;
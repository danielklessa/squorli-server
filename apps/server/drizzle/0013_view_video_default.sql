-- New permission VIEW_VIDEO (bit 14 = 16384, watch camera and screen shares). Guests do not get it (user decision
-- of 2026-09-17), so the default role stays as it is. Every other role was granted by an admin on purpose and keeps
-- what its members could do so far: all non-default roles get the bit ("Mitglied" becomes 24000 as on fresh servers).
UPDATE "roles" SET "permissions" = "permissions" | 16384 WHERE "is_default" = false;

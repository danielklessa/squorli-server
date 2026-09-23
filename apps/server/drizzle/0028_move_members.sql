-- Channel permissions (23 September 2026, docs/features/channel-permissions.md): moving members between voice channels is
-- its own right MOVE_MEMBERS (bit 16 = 65536) now, split off MODERATE_VOICE (bit 13 = 8192). Every role that could move
-- until now keeps being able to, so nothing changes for existing servers. BYPASS_STICKY (bit 17) needs no backfill.
UPDATE "roles" SET "permissions" = "permissions" | 65536 WHERE ("permissions" & 8192) <> 0;

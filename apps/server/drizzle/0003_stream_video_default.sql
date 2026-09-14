-- Neues Recht STREAM_VIDEO (Bit 12 = 4096) fuer bestehende Server in die Standardrolle uebernehmen,
-- so wie es DEFAULT_EVERYONE_PERMISSIONS fuer frische Server vorsieht.
UPDATE "roles" SET "permissions" = "permissions" | 4096 WHERE "is_default" = true;

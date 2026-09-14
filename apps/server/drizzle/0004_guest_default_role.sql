-- Standardrolle wird "Gast" mit nur VIEW_CHANNELS (128) | CONNECT_VOICE (1024) = 1152 (Entscheidung 13.09.2026).
-- Die bisherigen Rechte wandern in eine neue Rolle "Mitglied" (7616 = Gast + SEND_MESSAGES 256 + ATTACH_FILES 2048
-- + CREATE_INVITES 64 + STREAM_VIDEO 4096), die alle bereits vorhandenen Mitglieder bekommen, damit niemand etwas verliert.
-- Neue Beitritte sind ab jetzt Gaeste, bis ein Admin "Mitglied" vergibt.
UPDATE "roles" SET "name" = 'Gast', "permissions" = 1152 WHERE "is_default" = true;
--> statement-breakpoint
INSERT INTO "roles" ("name", "permissions", "position", "is_default", "color")
SELECT 'Mitglied', 7616, 1, false, '#3ba55c'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "name" = 'Mitglied' AND "is_default" = false);
--> statement-breakpoint
INSERT INTO "member_roles" ("user_id", "role_id")
SELECT m."user_id", r."id" FROM "members" m CROSS JOIN "roles" r
WHERE r."name" = 'Mitglied' AND r."is_default" = false
ON CONFLICT DO NOTHING;

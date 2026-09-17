-- Read states (0014) start with this update: without a row the server counts every message since a member joined as
-- unread, which would mark every channel for every existing member after the update. So each member gets a row per text
-- channel at its newest message ("everything up to now is read"). Channels without messages need none.
INSERT INTO "read_states" ("user_id", "channel_id", "last_read_seq")
SELECT m."user_id", c."id", max(msg."seq")
FROM "members" m
CROSS JOIN "channels" c
JOIN "messages" msg ON msg."channel_id" = c."id"
WHERE c."kind" = 'text'
GROUP BY m."user_id", c."id"
ON CONFLICT DO NOTHING;

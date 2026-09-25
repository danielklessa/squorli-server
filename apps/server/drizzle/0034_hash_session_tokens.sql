-- Session tokens are kept only as their SHA-256 (hex) since 25 September 2026 (security review): whoever reads the
-- database or a backup gets no usable token. Existing sessions stay valid: their tokens are hashed in place.
UPDATE "sessions" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');

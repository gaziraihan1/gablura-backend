-- Drop legacy tables: Session (NextAuth adapter model, unused under JWT
-- strategy) and RefreshToken (refresh-token rotation lives in Redis). Both
-- reference User, so they are safe to drop directly.
DROP TABLE IF EXISTS "RefreshToken";
DROP TABLE IF EXISTS "Session";

-- Track the last password change timestamp (password-age hardening).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastPasswordChange" TIMESTAMP(3);

-- +goose Up
-- Lets an admin lock an account out (spam sign-ups, abuse) without deleting it:
-- the row, its sites and its audit trail survive, and the lock is reversible.
-- NULL suspended_at = active.
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS suspended_by;
ALTER TABLE users DROP COLUMN IF EXISTS suspended_reason;
ALTER TABLE users DROP COLUMN IF EXISTS suspended_at;

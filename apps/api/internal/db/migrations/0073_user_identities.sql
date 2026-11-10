-- External sign-in identities (e.id first). One provider-agnostic table
-- instead of an oauth_<provider>_sub column per provider like Google in 0009.
-- subject = the provider's user ID; e.id sends none yet, so it holds the
-- email for now and can be swapped without a schema change. Same shape as
-- 0074_user_identities in the `website` repo.

-- +goose Up
CREATE TABLE IF NOT EXISTS user_identities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,
    subject       TEXT NOT NULL,
    email         TEXT NOT NULL DEFAULT '',
    tier          INT,
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities (user_id);

-- +goose Down
DROP TABLE IF EXISTS user_identities;

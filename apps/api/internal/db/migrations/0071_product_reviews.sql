-- +goose Up
-- Buyer-submitted product ratings. Public endpoint, so rows land as 'pending'
-- and the shop owner approves them before they show on the storefront.
CREATE TABLE IF NOT EXISTS product_reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id        UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    author_name    TEXT NOT NULL,
    -- Normalized (6281…) so we can match it against orders.customer_phone.
    -- Never exposed by the public API — only the derived verified_buyer flag is.
    author_phone   TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','published','rejected')),
    -- Resolved once at submit time: the phone matched an order in this site.
    verified_buyer BOOLEAN NOT NULL DEFAULT false,
    -- Optional public answer from the shop owner, shown under the review.
    reply          TEXT NOT NULL DEFAULT '',
    replied_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Storefront reads one product's published reviews, newest first.
CREATE INDEX IF NOT EXISTS idx_product_reviews_product
    ON product_reviews(product_id, status, created_at DESC);
-- Dashboard moderation inbox is scoped per site and filtered by status.
CREATE INDEX IF NOT EXISTS idx_product_reviews_site
    ON product_reviews(site_id, status, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS product_reviews;

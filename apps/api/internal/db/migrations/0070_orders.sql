-- +goose Up
-- UMKM shop orders: the buyer's cart lives in the browser, checkout POSTs it
-- here and the seller follows up over WhatsApp (payment happens off-platform).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS whatsapp_number TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    -- Per-site running number shown to buyer + seller as "#0042".
    seq              INT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','processing','done','cancelled')),
    customer_name    TEXT NOT NULL,
    customer_phone   TEXT NOT NULL,
    customer_address TEXT NOT NULL DEFAULT '',
    note             TEXT NOT NULL DEFAULT '',
    -- Snapshot of name/price at order time; products may change or vanish later.
    items_json       JSONB NOT NULL,
    total            BIGINT NOT NULL,
    currency         TEXT NOT NULL DEFAULT 'IDR',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_orders_site_created ON orders(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_site_status  ON orders(site_id, status);

-- +goose Down
DROP TABLE IF EXISTS orders;
ALTER TABLE sites DROP COLUMN IF EXISTS whatsapp_number;

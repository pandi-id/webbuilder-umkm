-- +goose Up
-- UMKM pivot: guru/teacher templates are no longer seeded. Seed only upserts,
-- so stale rows would linger in the picker without this. sites.template_id is
-- ON DELETE SET NULL, so existing sites keep working.
DELETE FROM templates
 WHERE category = 'teacher'
    OR category LIKE 'guru-pandi%'
    OR slug = 'guru-pandi-upi';

-- +goose Down
-- Rows come from the Go seed; nothing to restore in SQL.
SELECT 1;

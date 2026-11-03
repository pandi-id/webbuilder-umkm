// domain_repo.go — current-state per-domain aggregate (tabel `domains`).
// Terpisah dari domain_purchases yang jadi transaction log.
//
// Design invariants:
//   - 1 row per FQDN (UNIQUE constraint di name).
//   - Upsert idempotent: register ulang domain yg sama (idempotency via api-registry)
//     tidak duplicate — cukup update timestamps.
//   - Renew NO create new row — cuma UPDATE expires_at + last_renewed_at.

package domain_purchase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Domain — 1 baris tabel `registered_domains`. Bukan purchase — ini aggregate state.
type Domain struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	PurchasedBy    *uuid.UUID
	Name           string
	ContactID      string
	ExpiresAt      *time.Time
	RegisteredAt   time.Time
	LastRenewedAt  *time.Time
	Status         string
	SiteID         *uuid.UUID
	RegistrarJobID string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	// DNSAttachStatus — status auto-attach ke DNS provider (pending|success|failed|skipped).
	// Populated via tryAttachToDNS pasca register. Admin bisa retry kalau failed
	// via /admin/domains/:name/dns-retry.
	DNSAttachStatus     string
	DNSAttachError      string
	DNSAttachAt         *time.Time
	DNSZoneID           string
	DNSProvider         string     // 'cloudflare' | 'dnscloud'
	DNSProviderConfigID *uuid.UUID // sticky — reconciler/retry MUST use this config
}

const domainCols = `id, user_id, purchased_by, name, contact_id, expires_at,
	registered_at, last_renewed_at, status, site_id, registrar_job_id,
	created_at, updated_at,
	dns_attach_status, dns_attach_error, dns_attach_at, dns_zone_id,
	dns_provider, dns_provider_config_id`

// effectiveSiteIDSQL — site_id dengan fallback ke domain_purchases.
// `registered_domains.site_id` historis tidak selalu di-populate (templates
// handler cuma update domain_purchases.site_id), jadi read path fallback ke
// sumber authoritative supaya UI tidak salah tampil "Belum ada situs"
// padahal site sudah ada. Wajib dipakai juga oleh filter + hitungan stats,
// kalau tidak angka "tanpa situs" jadi over-count.
const effectiveSiteIDSQL = `COALESCE(rd.site_id, (
		SELECT dp.site_id FROM domain_purchases dp
		WHERE dp.domain = rd.name
		  AND dp.kind = 'register'
		  AND dp.site_id IS NOT NULL
		ORDER BY dp.created_at DESC
		LIMIT 1
	))`

const domainColsWithSiteFallback = `rd.id, rd.user_id, rd.purchased_by, rd.name,
	rd.contact_id, rd.expires_at, rd.registered_at, rd.last_renewed_at, rd.status,
	` + effectiveSiteIDSQL + ` AS site_id,
	rd.registrar_job_id, rd.created_at, rd.updated_at,
	rd.dns_attach_status, rd.dns_attach_error, rd.dns_attach_at, rd.dns_zone_id,
	rd.dns_provider, rd.dns_provider_config_id`

func scanDomain(row pgx.Row, d *Domain) error {
	return row.Scan(
		&d.ID, &d.UserID, &d.PurchasedBy, &d.Name, &d.ContactID, &d.ExpiresAt,
		&d.RegisteredAt, &d.LastRenewedAt, &d.Status, &d.SiteID, &d.RegistrarJobID,
		&d.CreatedAt, &d.UpdatedAt,
		&d.DNSAttachStatus, &d.DNSAttachError, &d.DNSAttachAt, &d.DNSZoneID,
		&d.DNSProvider, &d.DNSProviderConfigID,
	)
}

// UpsertDomain — dipanggil executeRegister setelah EPP CREATE sukses. Idempotent:
// register ulang domain yang sama (api-registry idempotent by identity) →
// UPDATE existing row.
func (r *Repo) UpsertDomain(ctx context.Context, d Domain) (*Domain, error) {
	q := `
		INSERT INTO registered_domains (
			user_id, purchased_by, name, contact_id, expires_at,
			registered_at, status, site_id, registrar_job_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (name) DO UPDATE SET
			user_id          = EXCLUDED.user_id,
			purchased_by     = EXCLUDED.purchased_by,
			contact_id       = COALESCE(NULLIF(EXCLUDED.contact_id, ''), registered_domains.contact_id),
			expires_at       = COALESCE(EXCLUDED.expires_at, registered_domains.expires_at),
			status           = EXCLUDED.status,
			registrar_job_id = COALESCE(NULLIF(EXCLUDED.registrar_job_id, ''), registered_domains.registrar_job_id),
			updated_at       = now()
		RETURNING ` + domainCols
	registeredAt := d.RegisteredAt
	if registeredAt.IsZero() {
		registeredAt = time.Now()
	}
	status := d.Status
	if status == "" {
		status = "active"
	}
	var out Domain
	if err := scanDomain(
		r.pool.QueryRow(ctx, q,
			d.UserID, d.PurchasedBy, d.Name, d.ContactID, d.ExpiresAt,
			registeredAt, status, d.SiteID, d.RegistrarJobID,
		), &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// UpdateDomainExpiry — dipanggil executeRenew setelah EPP RENEW sukses.
// Tidak bikin row baru — cuma extend expires_at + record last_renewed_at.
func (r *Repo) UpdateDomainExpiry(ctx context.Context, name string, expiresAt time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE registered_domains SET
			expires_at      = $2,
			last_renewed_at = now(),
			updated_at      = now()
		 WHERE name = $1
	`, name, expiresAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DNS attach status constants — mirror kolom dns_attach_status enum.
const (
	DNSAttachPending = "pending" // belum di-attempt (default row baru)
	DNSAttachSuccess = "success" // zone created + NS pushed OK
	DNSAttachFailed  = "failed"  // ada error di zone create / NS push / DNS
	DNSAttachSkipped = "skipped" // config provider belum ada, sengaja tidak coba
)

// SetDomainDNSAttach — persist hasil tryAttachToDNS. Best-effort: dipanggil
// per outcome supaya admin bisa lihat status di UI + retry manual kalau
// failed. Kalau row tidak ada (domain belum masuk registered_domains),
// no-op — biasanya karena race dengan UpsertDomain yang sync juga jalan;
// retry berikutnya akan match.
//
// zoneID + provider + providerConfigID disimpan supaya reconciler + retry
// pakai provider yang SAMA (sticky), bukan priority provider terbaru.
func (r *Repo) SetDomainDNSAttach(ctx context.Context, name, status, errMsg, zoneID, provider string, providerConfigID *uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE registered_domains SET
			dns_attach_status      = $2,
			dns_attach_error       = $3,
			dns_zone_id            = COALESCE(NULLIF($4, ''), dns_zone_id),
			dns_provider           = COALESCE(NULLIF($5, ''), dns_provider),
			dns_provider_config_id = COALESCE($6, dns_provider_config_id),
			dns_attach_at          = now(),
			updated_at             = now()
		 WHERE name = $1
	`, name, status, errMsg, zoneID, provider, providerConfigID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetDomainProviderSwitch — admin-level: ganti provider ownership total.
// Beda dengan SetDomainDNSAttach yang pakai COALESCE (preserve kalau empty),
// method ini overwrite semua field langsung — supaya switch ke 'external'
// bisa clear zone_id + config_id ke NULL/empty tanpa stuck ke nilai lama.
//
// Pakai di flow:
//   - Switch provider CF → DNSCloud: new zone_id, new config_id
//   - Switch provider CF → external: zone_id=”, config_id=nil
//
// Caller bertanggung jawab delete zone lama (best-effort, di handler).
func (r *Repo) SetDomainProviderSwitch(ctx context.Context, name, provider, zoneID string, configID *uuid.UUID, status, errMsg string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE registered_domains SET
			dns_attach_status      = $2,
			dns_attach_error       = $3,
			dns_zone_id            = $4,
			dns_provider           = $5,
			dns_provider_config_id = $6,
			dns_attach_at          = now(),
			updated_at             = now()
		 WHERE name = $1
	`, name, status, errMsg, zoneID, provider, configID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetDomainContact — dipanggil kalau user update WHOIS contact via portal.
func (r *Repo) SetDomainContact(ctx context.Context, name, contactID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE registered_domains SET contact_id = $2, updated_at = now() WHERE name = $1
	`, name, contactID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetDomainByName — ownership-scoped fetch (inclusive purchased_by).
// Return ErrNotFound kalau caller bukan owner (user_id) DAN bukan purchaser
// (purchased_by via on-behalf-of).
func (r *Repo) GetDomainByName(ctx context.Context, name string, userID uuid.UUID) (*Domain, error) {
	q := `SELECT ` + domainCols + `
		FROM registered_domains
		WHERE name = $1 AND (user_id = $2 OR purchased_by = $2)`
	var d Domain
	if err := scanDomain(r.pool.QueryRow(ctx, q, name, userID), &d); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &d, nil
}

// GetDomainBySite — purchased anchor for a site, if any. Returns ErrNotFound
// when the site has no active registered domain attached.
func (r *Repo) GetDomainBySite(ctx context.Context, siteID uuid.UUID) (*Domain, error) {
	q := `SELECT ` + domainColsWithSiteFallback + `
		FROM registered_domains rd
		WHERE rd.status = 'active'
		  AND (rd.site_id = $1 OR EXISTS (
			SELECT 1 FROM domain_purchases dp
			 WHERE dp.domain = rd.name AND dp.kind = 'register' AND dp.site_id = $1
		  ))
		LIMIT 1`
	var d Domain
	if err := scanDomain(r.pool.QueryRow(ctx, q, siteID), &d); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &d, nil
}

// GetDomainByNameAdmin — bypass ownership. Dipakai admin detail page yang
// perlu troubleshoot domain lintas user (mis. "domain user X tidak accessible").
func (r *Repo) GetDomainByNameAdmin(ctx context.Context, name string) (*Domain, error) {
	q := `SELECT ` + domainCols + ` FROM registered_domains WHERE name = $1`
	var d Domain
	if err := scanDomain(r.pool.QueryRow(ctx, q, name), &d); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &d, nil
}

// ListDomainsByUser — semua domain yang caller "manage": jadi `user_id`
// (self-purchase / owner) ATAU `purchased_by` (agent/reseller yang trigger
// register on-behalf-of). Agent yang beli untuk klien tetap kelihatan di
// list-nya sendiri walau klien yang jadi owner formal.
func (r *Repo) ListDomainsByUser(ctx context.Context, userID uuid.UUID) ([]Domain, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+domainColsWithSiteFallback+`
		FROM registered_domains rd
		WHERE rd.user_id = $1 OR rd.purchased_by = $1
		ORDER BY rd.expires_at ASC NULLS LAST, rd.name ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Domain{}
	for rows.Next() {
		var d Domain
		if err := scanDomain(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ListDomainsByUsers — bulk untuk reseller/agent team scope. Include semua
// domain yang user_id ATAU purchased_by nya di list (untuk cover team's
// on-behalf-of). Dipakai /reseller/domains + /agent/domains.
func (r *Repo) ListDomainsByUsers(ctx context.Context, userIDs []uuid.UUID) ([]Domain, error) {
	if len(userIDs) == 0 {
		return []Domain{}, nil
	}
	rows, err := r.pool.Query(ctx, `SELECT `+domainColsWithSiteFallback+`
		FROM registered_domains rd
		WHERE rd.user_id = ANY($1) OR rd.purchased_by = ANY($1)
		ORDER BY rd.expires_at ASC NULLS LAST, rd.name ASC`, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Domain{}
	for rows.Next() {
		var d Domain
		if err := scanDomain(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// AdminDomain — 1 row untuk admin observability. Include owner info dari
// join users supaya UI tidak perlu second-fetch.
type AdminDomain struct {
	Domain
	OwnerEmail string
	OwnerName  string
}

// AdminDomainFilter — filter query untuk admin aggregate list.
type AdminDomainFilter struct {
	Q            string // search di name atau owner email
	Status       string // "" = semua
	ExpiringDays int    // > 0 → active + expires_at ≤ now + N days
	WithoutSite  bool   // true → hanya domain yang belum ter-attach ke situs
	// Rentang tanggal pendaftaran (kolom "Terdaftar" di UI). Half-open:
	// CreatedTo di-set ke awal hari BERIKUTNYA oleh caller, supaya domain
	// yang didaftarkan pada hari itu juga ikut terambil.
	CreatedFrom *time.Time
	CreatedTo   *time.Time
	Page        int
	PageSize    int
	// Export lifts the 200-row page cap for CSV download, which must return
	// the whole filtered set rather than one screen of it. Still bounded by
	// AdminExportMaxRows so a single request cannot pull the entire table.
	Export bool
}

// AdminExportMaxRows caps a CSV export. Large enough for real admin work,
// small enough that one request cannot exhaust memory.
const AdminExportMaxRows = 10000

// AdminListDomains — paginated + filter, join users. Dipakai halaman
// /admin/domain untuk observability semua domain lintas user.
func (r *Repo) AdminListDomains(ctx context.Context, f AdminDomainFilter) ([]AdminDomain, int, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	switch {
	case f.Export:
		// A silently-capped export is worse than a slow one: the admin would
		// get a short file with no sign anything was missing.
		if f.PageSize <= 0 || f.PageSize > AdminExportMaxRows {
			f.PageSize = AdminExportMaxRows
		}
	case f.PageSize <= 0 || f.PageSize > 200:
		f.PageSize = 30
	}

	where := "WHERE 1=1"
	args := []any{}
	if f.Status != "" {
		args = append(args, f.Status)
		where += fmt.Sprintf(" AND rd.status = $%d", len(args))
	}
	if f.ExpiringDays > 0 {
		args = append(args, f.ExpiringDays)
		where += " AND rd.status = 'active' AND rd.expires_at IS NOT NULL"
		where += fmt.Sprintf(" AND rd.expires_at <= now() + ($%d || ' days')::interval", len(args))
	}
	if f.WithoutSite {
		where += " AND " + effectiveSiteIDSQL + " IS NULL"
	}
	if f.Q != "" {
		args = append(args, "%"+f.Q+"%")
		where += fmt.Sprintf(" AND (rd.name ILIKE $%d OR u.email ILIKE $%d OR u.name ILIKE $%d)",
			len(args), len(args), len(args))
	}
	if f.CreatedFrom != nil {
		args = append(args, *f.CreatedFrom)
		where += fmt.Sprintf(" AND rd.registered_at >= $%d", len(args))
	}
	if f.CreatedTo != nil {
		args = append(args, *f.CreatedTo)
		where += fmt.Sprintf(" AND rd.registered_at < $%d", len(args))
	}

	var total int
	countQ := `SELECT COUNT(*) FROM registered_domains rd
		LEFT JOIN users u ON u.id = rd.user_id ` + where
	if err := r.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (f.Page - 1) * f.PageSize
	args = append(args, f.PageSize, offset)
	q := `SELECT
			rd.id, rd.user_id, rd.purchased_by, rd.name, rd.contact_id, rd.expires_at,
			rd.registered_at, rd.last_renewed_at, rd.status,
			` + effectiveSiteIDSQL + ` AS site_id, rd.registrar_job_id,
			rd.created_at, rd.updated_at,
			COALESCE(u.email, ''), COALESCE(u.name, '')
		FROM registered_domains rd
		LEFT JOIN users u ON u.id = rd.user_id ` + where + `
		ORDER BY rd.expires_at ASC NULLS LAST, rd.name ASC
		LIMIT $` + fmt.Sprint(len(args)-1) + ` OFFSET $` + fmt.Sprint(len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AdminDomain{}
	for rows.Next() {
		var a AdminDomain
		if err := rows.Scan(
			&a.ID, &a.UserID, &a.PurchasedBy, &a.Name, &a.ContactID, &a.ExpiresAt,
			&a.RegisteredAt, &a.LastRenewedAt, &a.Status, &a.SiteID, &a.RegistrarJobID,
			&a.CreatedAt, &a.UpdatedAt,
			&a.OwnerEmail, &a.OwnerName,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, a)
	}
	return out, total, rows.Err()
}

// AdminDomainStats — ringkasan kartu di /admin/domain.
type AdminDomainStats struct {
	TotalActive       int
	ActiveWithoutSite int
}

// AdminDomainStats — dua angka dalam satu scan supaya kartu tidak butuh
// dua round-trip. Scope-nya status='active' saja: domain expired/suspended
// tanpa situs bukan actionable buat ops.
func (r *Repo) AdminDomainStats(ctx context.Context) (AdminDomainStats, error) {
	var out AdminDomainStats
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE `+effectiveSiteIDSQL+` IS NULL)
		  FROM registered_domains rd
		 WHERE rd.status = 'active'`).Scan(&out.TotalActive, &out.ActiveWithoutSite)
	if err != nil {
		return AdminDomainStats{}, err
	}
	return out, nil
}

// AttachDomainSite — link domain ke sites row.
func (r *Repo) AttachDomainSite(ctx context.Context, name string, userID, siteID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE registered_domains SET site_id = $3, updated_at = now()
		 WHERE name = $1 AND user_id = $2
	`, name, userID, siteID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

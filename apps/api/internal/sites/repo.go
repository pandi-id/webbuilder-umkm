package sites

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Site struct {
	ID                   uuid.UUID       `json:"id"`
	UserID               uuid.UUID       `json:"user_id"`
	Slug                 string          `json:"slug"`
	Name                 string          `json:"name"`
	TemplateID           *uuid.UUID      `json:"template_id,omitempty"`
	Theme                json.RawMessage `json:"theme"`
	// Layout — shared header/footer per site. Renderer prepend header +
	// append footer ke setiap page saat render. Struktur:
	//   { "header": [BlockData...], "footer": [BlockData...] }
	// Kosong `{}` = renderer render page.tree apa adanya (backward compat
	// untuk sites lama sebelum data migration).
	Layout               json.RawMessage `json:"layout"`
	Status               string          `json:"status"`
	QuotaMaxPages        int             `json:"quota_max_pages"`
	QuotaMaxStorageBytes int64           `json:"quota_max_storage_bytes"`
	QuotaMaxProducts     int             `json:"quota_max_products"`
	QuotaMaxBlogPosts    int             `json:"quota_max_blog_posts"`
	// Custom code injection — raw HTML/JS user, di-render apa adanya oleh
	// renderer + exporter. Kosong = tidak inject. Ukuran dijaga di handler
	// (MaxCustomCodeBytes) supaya tidak abuse storage / render payload.
	CustomHeadCode    string    `json:"custom_head_code"`
	CustomBodyEndCode string    `json:"custom_body_end_code"`
	// WhatsAppNumber — seller's number in 62… form; checkout opens wa.me with it.
	WhatsAppNumber    string    `json:"whatsapp_number"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// MaxCustomCodeBytes = batas atas per field (~16KB). Cukup untuk analytics/
// chat widget snippet, cegah user tempel payload gigabytes.
const MaxCustomCodeBytes = 16 * 1024

// siteCols is the SELECT column list, kept in sync with scanArgs.
const siteCols = `id, user_id, slug, name, template_id, theme_json, layout_json, status,
    quota_max_pages, quota_max_storage_bytes, quota_max_products, quota_max_blog_posts,
    custom_head_code, custom_body_end_code, whatsapp_number,
    created_at, updated_at`

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

var ErrNotFound = errors.New("not found")
var ErrSlugTaken = errors.New("slug taken")
func (r *Repo) Create(ctx context.Context, userID uuid.UUID, slug, name string, templateID *uuid.UUID, theme json.RawMessage) (*Site, error) {
	// No per-user site cap: each site is paid for by its own domain purchase
	// (1 domain = 1 site, enforced in templates.CreateSiteFromTemplate).
	if theme == nil {
		theme = json.RawMessage(`{}`)
	}
	var s Site
	err := r.pool.QueryRow(ctx, `
		INSERT INTO sites (user_id, slug, name, template_id, theme_json)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+siteCols+`
	`, userID, slug, name, templateID, theme).Scan(scanArgs(&s)...)
	if pgErrCode(err) == "23505" {
		return nil, ErrSlugTaken
	}
	if err != nil {
		return nil, err
	}
	// Register owner di site_members — supaya query yang cek collab access
	// via site_members langsung match. Idempotent (ON CONFLICT DO NOTHING),
	// fail-silent kalau membership table down (owner check via sites.user_id
	// masih jalan sebagai fallback).
	_ = r.EnsureOwner(ctx, s.ID, userID)
	return &s, nil
}

// scanArgs returns the pointer list matching siteCols, in order.
func scanArgs(s *Site) []any {
	return []any{
		&s.ID, &s.UserID, &s.Slug, &s.Name, &s.TemplateID, &s.Theme, &s.Layout, &s.Status,
		&s.QuotaMaxPages, &s.QuotaMaxStorageBytes, &s.QuotaMaxProducts, &s.QuotaMaxBlogPosts,
		&s.CustomHeadCode, &s.CustomBodyEndCode, &s.WhatsAppNumber,
		&s.CreatedAt, &s.UpdatedAt,
	}
}

func (r *Repo) ListByUser(ctx context.Context, userID uuid.UUID) ([]Site, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+siteCols+`
		FROM sites WHERE user_id = $1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Site{}
	for rows.Next() {
		var s Site
		if err := rows.Scan(scanArgs(&s)...); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetOwned lookup site oleh user yang punya akses (owner/editor/viewer).
// Nama historis "Owned" dipertahankan agar tidak refactor semua caller —
// scope sudah diperluas ke collaborator via site_members (Phase 4).
// Kalau butuh strict owner-only check (mis. Delete), pakai `GetStrictlyOwned`.
func (r *Repo) GetOwned(ctx context.Context, id, userID uuid.UUID) (*Site, error) {
	var s Site
	err := r.pool.QueryRow(ctx, `
		SELECT `+siteCols+`
		  FROM sites
		 WHERE id = $1
		   AND id IN (
		       SELECT site_id FROM site_members WHERE user_id = $2
		   )
	`, id, userID).Scan(scanArgs(&s)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// GetOwnedOrAdmin — sama seperti GetOwned tapi bypass ownership check kalau
// caller adalah admin. Admin butuh full read/write ke site user untuk
// keperluan debugging + support tickets (mis. user lapor editor error →
// admin buka site langsung sebagai owner untuk reproduce/inspect).
//
// Handler yang pakai method ini SHOULD log akses admin ke audit_log supaya
// ada trail siapa masuk ke site siapa & kapan. Untuk MVP saat ini, audit
// dilakukan on-demand via `/admin/audit-log` search — belum auto-record.
func (r *Repo) GetOwnedOrAdmin(ctx context.Context, id, userID uuid.UUID, isAdmin bool) (*Site, error) {
	if isAdmin {
		return r.GetByID(ctx, id)
	}
	return r.GetOwned(ctx, id, userID)
}

// GetStrictlyOwned — original semantic (sites.user_id = userID). Dipakai
// untuk operasi destructive yang HARUS owner (Delete, transfer ownership).
func (r *Repo) GetStrictlyOwned(ctx context.Context, id, userID uuid.UUID) (*Site, error) {
	var s Site
	err := r.pool.QueryRow(ctx, `
		SELECT `+siteCols+`
		FROM sites WHERE id = $1 AND user_id = $2
	`, id, userID).Scan(scanArgs(&s)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// GetByID fetches a site without owner scoping. ONLY call this from contexts
// that already validated capability via another mechanism (e.g. preview HMAC
// token). Avoid using it in user-facing endpoints — prefer GetOwned.
func (r *Repo) GetByID(ctx context.Context, id uuid.UUID) (*Site, error) {
	var s Site
	err := r.pool.QueryRow(ctx, `
		SELECT `+siteCols+`
		FROM sites WHERE id = $1
	`, id).Scan(scanArgs(&s)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// UpdateFields — patch semua field yang bisa di-set user. Pointer=nil skip
// (COALESCE), sedangkan string kosong = "clear" untuk custom code. Ini beda
// dari name/status yang tidak boleh kosong.
type UpdateFields struct {
	Name              *string
	Theme             json.RawMessage
	Layout            json.RawMessage
	Status            *string
	CustomHeadCode    *string
	CustomBodyEndCode *string
	WhatsAppNumber    *string // already normalised by the handler; "" clears
}

func (r *Repo) Update(ctx context.Context, id, userID uuid.UUID, f UpdateFields) (*Site, error) {
	return r.updateInternal(ctx, id, userID, f, false)
}

// UpdateOrAdmin — Update site dengan admin bypass ownership check.
// Dipakai handler yang expose admin support flow (mis. sites.Update)
// supaya admin bisa Save perubahan dari /admin/sites → editor.
func (r *Repo) UpdateOrAdmin(ctx context.Context, id, userID uuid.UUID, f UpdateFields, isAdmin bool) (*Site, error) {
	return r.updateInternal(ctx, id, userID, f, isAdmin)
}

func (r *Repo) updateInternal(ctx context.Context, id, userID uuid.UUID, f UpdateFields, isAdmin bool) (*Site, error) {
	// Update boleh dilakukan oleh owner ATAU editor (site_members).
	// Filter role via subquery IN site_members supaya reseller/agent yang
	// di-add sebagai editor bisa update site milik client. Admin bypass
	// check ini sepenuhnya (support/debug flow).
	memberCheck := `
		  AND id IN (
		      SELECT site_id FROM site_members
		       WHERE user_id = $2 AND role IN ('owner','editor')
		  )`
	if isAdmin {
		memberCheck = "" // no ownership constraint
	}
	var s Site
	err := r.pool.QueryRow(ctx, `
		UPDATE sites SET
			name                 = COALESCE($3, name),
			theme_json           = COALESCE($4, theme_json),
			layout_json          = COALESCE($5, layout_json),
			status               = COALESCE($6, status),
			custom_head_code     = COALESCE($7, custom_head_code),
			custom_body_end_code = COALESCE($8, custom_body_end_code),
			whatsapp_number      = COALESCE($9, whatsapp_number),
			updated_at           = now()
		WHERE id = $1`+memberCheck+`
		RETURNING `+siteCols+`
	`, id, userID, f.Name, f.Theme, f.Layout, f.Status, f.CustomHeadCode, f.CustomBodyEndCode, f.WhatsAppNumber).Scan(scanArgs(&s)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// IsPublished — cek cepat apakah site masih status='published'. Return
// true kalau ada, false kalau draft/archived/deleted. Dipakai public
// endpoints yang butuh gate "site still live?" secara defensive (kalau
// admin unpublish site sementara request in-flight, endpoint bisa reject
// tanpa full re-fetch). Query indexed by PK id — negligible overhead.
func (r *Repo) IsPublished(ctx context.Context, id uuid.UUID) (bool, error) {
	var status string
	err := r.pool.QueryRow(ctx,
		`SELECT status FROM sites WHERE id = $1`, id,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == "published", nil
}

// SetLayoutRaw sets sites.layout_json directly, tanpa ownership check.
// Dipakai server-side flow (template apply, CreateSiteFromTemplate) yang
// sudah verify caller. Untuk user-facing PATCH pakai UpdateOrAdmin dengan
// UpdateFields.Layout.
func (r *Repo) SetLayoutRaw(ctx context.Context, id uuid.UUID, layout json.RawMessage) error {
	if len(layout) == 0 {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`UPDATE sites SET layout_json = $2, updated_at = now() WHERE id = $1`,
		id, layout,
	)
	return err
}

func (r *Repo) Delete(ctx context.Context, id, userID uuid.UUID) error {
	ct, err := r.pool.Exec(ctx, `DELETE FROM sites WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetPrimaryHostname reads sites.primary_hostname. NULL (no row returned as
// empty string) means "fallback to the purchased anchor" — caller resolves.
func (r *Repo) GetPrimaryHostname(ctx context.Context, id uuid.UUID) (string, error) {
	var h *string
	err := r.pool.QueryRow(ctx,
		`SELECT primary_hostname FROM sites WHERE id = $1`, id,
	).Scan(&h)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if h == nil {
		return "", nil
	}
	return *h, nil
}

// SetPrimaryHostname assigns the canonical host for a site. Pass hostname=""
// to clear (reverts to anchor fallback).
func (r *Repo) SetPrimaryHostname(ctx context.Context, id, userID uuid.UUID, hostname string) error {
	var v *string
	if hostname != "" {
		v = &hostname
	}
	ct, err := r.pool.Exec(ctx,
		`UPDATE sites SET primary_hostname = $3, updated_at = now()
		  WHERE id = $1 AND user_id = $2`,
		id, userID, v,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetByHost looks up a published site by associated domain hostname.
//
// Dual lookup — dua tabel bisa link domain ke situs:
//  1. `domain_purchases` — flow utama: domain dibeli via PANDI wizard,
//     auto-attach ke site setelah checkout. Status = 'active', kind =
//     'register' (renew jobs tidak attach, hanya extend expiry).
//  2. `domains` — legacy BYO flow (user hubungkan domain dari registrar
//     lain, verify via A record). Status = 'verified'.
//
// DETERMINISTIC: sub-query menghasilkan tepat 1 site_id (dengan COALESCE +
// ORDER BY), lalu SELECT site by ID. Cegah cross-tenant leak yang bisa
// terjadi kalau `WHERE ... EXISTS ... LIMIT 1` non-deterministic — misal
// domain sama muncul di 2 domain_purchases row karena data anomali
// (register orphan + register baru site lain).
//
// Site harus status='published' — draft tidak muncul di renderer.
func (r *Repo) GetByHost(ctx context.Context, host string) (*Site, error) {
	var s Site
	err := r.pool.QueryRow(ctx, `
		SELECT `+sitePrefixedCols("s")+`
		FROM sites s
		WHERE s.status = 'published'
		  AND s.id = COALESCE(
			-- Priority 1: purchase-flow domain, ambil register row aktif
			-- paling baru (ORDER BY created_at DESC). Filter kind='register'
			-- penting — renew row tidak attach ke site (site_id nullable).
			(
				SELECT dp.site_id
				  FROM domain_purchases dp
				 WHERE dp.domain = $1
				   AND dp.status = 'active'
				   AND dp.kind = 'register'
				   AND dp.site_id IS NOT NULL
				 ORDER BY dp.created_at DESC
				 LIMIT 1
			),
			-- Priority 2: legacy BYO domain (UNIQUE hostname, aman deterministic).
			(
				SELECT d.site_id
				  FROM domains d
				 WHERE d.hostname = $1
				   AND d.status = 'verified'
				 LIMIT 1
			),
			-- Priority 3: BYO .id via Cloudflare NS. UNIQUE hostname. Drifting
			-- rows still resolve — cert may be valid even during propagation
			-- hiccup, user sees content until suspension kicks in at 7d.
			(
				SELECT b.site_id
				  FROM site_byo_domains b
				 WHERE b.hostname = $1
				   AND b.status IN ('verified','drifting')
				 LIMIT 1
			)
		  )
		LIMIT 1
	`, host).Scan(scanArgs(&s)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// HasSiteForHost returns true kalau ada situs (published atau draft) yang
// link ke host ini — dipakai renderer untuk membedakan pesan:
//   - HasSite=false → domain belum di-attach ke situs mana pun
//   - HasSite=true tapi GetByHost tidak return → site ada tapi belum publish
// Backend: dual-check di domains + domain_purchases, tanpa filter status.
// Kind filter 'register' konsisten dengan GetByHost — renew row bukan
// indikator bahwa site punya domain (renew tidak attach).
func (r *Repo) HasSiteForHost(ctx context.Context, host string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM domains d
			 WHERE d.hostname = $1 AND d.site_id IS NOT NULL
		) OR EXISTS (
			SELECT 1 FROM domain_purchases dp
			 WHERE dp.domain = $1
			   AND dp.kind = 'register'
			   AND dp.site_id IS NOT NULL
		) OR EXISTS (
			SELECT 1 FROM site_byo_domains b
			 WHERE b.hostname = $1
		)
	`, host).Scan(&exists)
	return exists, err
}

// sitePrefixedCols returns siteCols with a table alias for JOIN queries.
func sitePrefixedCols(alias string) string {
	cols := []string{
		"id", "user_id", "slug", "name", "template_id", "theme_json", "layout_json", "status",
		"quota_max_pages", "quota_max_storage_bytes", "quota_max_products", "quota_max_blog_posts",
		"custom_head_code", "custom_body_end_code", "whatsapp_number",
		"created_at", "updated_at",
	}
	out := ""
	for i, c := range cols {
		if i > 0 {
			out += ", "
		}
		out += alias + "." + c
	}
	return out
}

func pgErrCode(err error) string {
	type pgErr interface{ SQLState() string }
	if e, ok := err.(pgErr); ok {
		return e.SQLState()
	}
	return ""
}

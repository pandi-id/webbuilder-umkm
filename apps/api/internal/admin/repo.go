package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

var ErrNotFound = errors.New("not found")

// ---------- Users ----------

type UserRow struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	SiteCount int       `json:"site_count"`
	// Nil = active. Shown in the list so a locked spam account is visible
	// at a glance instead of only on its detail page.
	SuspendedAt     *time.Time `json:"suspended_at,omitempty"`
	SuspendedReason string     `json:"suspended_reason,omitempty"`
}

// orderUsersSQL whitelists sort presets to safe ORDER BY fragments.
func orderUsersSQL(sort string) string {
	switch sort {
	case "email_asc":
		return "u.email ASC"
	case "email_desc":
		return "u.email DESC"
	case "sites_desc":
		return "site_count DESC, u.created_at DESC"
	case "oldest":
		return "u.created_at ASC"
	case "newest", "":
		return "u.created_at DESC"
	}
	return "u.created_at DESC"
}

// ListUsersPage returns one paginated page of users, with site counts and
// an ILIKE filter over email/name. Total reflects the filtered count.
func (r *Repo) ListUsersPage(ctx context.Context, like, sort string, limit, offset int) ([]UserRow, int, error) {
	var total int
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM users u
		WHERE LOWER(u.email) LIKE $1 OR LOWER(u.name) LIKE $1
	`, like).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := fmt.Sprintf(`
		SELECT u.id, u.email, u.name, u.role, u.created_at,
		       COUNT(s.id) AS site_count, u.suspended_at, u.suspended_reason
		FROM users u
		LEFT JOIN sites s ON s.user_id = u.id
		WHERE LOWER(u.email) LIKE $1 OR LOWER(u.name) LIKE $1
		GROUP BY u.id
		ORDER BY %s
		LIMIT $2 OFFSET $3
	`, orderUsersSQL(sort))

	rows, err := r.pool.Query(ctx, q, like, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []UserRow{}
	for rows.Next() {
		var u UserRow
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.CreatedAt, &u.SiteCount,
			&u.SuspendedAt, &u.SuspendedReason); err != nil {
			return nil, 0, err
		}
		out = append(out, u)
	}
	return out, total, rows.Err()
}

// UserDetail — payload lengkap 1 user untuk admin detail page.
// Superset dari UserRow: tambah profile (phone/address/dst.) + counts.
type UserDetail struct {
	UserRow
	PhoneNumber         string     `json:"phone_number,omitempty"`
	Address             string     `json:"address,omitempty"`
	City                string     `json:"city,omitempty"`
	State               string     `json:"state,omitempty"`
	PostalCode          string     `json:"postal_code,omitempty"`
	Nik                 string     `json:"nik,omitempty"`
	EmailVerifiedAt     *time.Time `json:"email_verified_at,omitempty"`
	// Reseller/agent context (kalau applicable).
	ParentResellerID    *string    `json:"parent_reseller_id,omitempty"`
	ResellerDisplayName string     `json:"reseller_display_name,omitempty"`
	ResellerStatus      string     `json:"reseller_status,omitempty"`
	ResellerTier        string     `json:"reseller_tier,omitempty"`
	// OAuth linking (kalau login via Google).
	HasPasswordLogin bool `json:"has_password_login"`
	HasGoogleLogin   bool `json:"has_google_login"`
	// Counts agregat.
	PublishedSites int `json:"published_sites"`
	DomainCount    int `json:"domain_count"`
}

// GetUserDetail — full profile + counts untuk admin detail page.
func (r *Repo) GetUserDetail(ctx context.Context, id uuid.UUID) (*UserDetail, error) {
	var d UserDetail
	var hasPassword, hasGoogle bool
	err := r.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.name, u.role, u.created_at,
		       COALESCE(u.phone_number, ''), COALESCE(u.address, ''),
		       COALESCE(u.city, ''), COALESCE(u.state, ''),
		       COALESCE(u.postal_code, ''), COALESCE(u.nik, ''),
		       u.email_verified_at,
		       u.parent_reseller_id, COALESCE(u.reseller_display_name, ''),
		       COALESCE(u.reseller_status, ''), COALESCE(u.reseller_tier, ''),
		       (u.password_hash IS NOT NULL AND u.password_hash <> '') AS has_password,
		       (u.oauth_google_sub IS NOT NULL AND u.oauth_google_sub <> '') AS has_google,
		       COALESCE((SELECT COUNT(*) FROM sites s WHERE s.user_id = u.id), 0) AS site_count,
		       COALESCE((SELECT COUNT(*) FROM sites s WHERE s.user_id = u.id AND s.status = 'published'), 0) AS published,
		       COALESCE((SELECT COUNT(*) FROM domain_purchases dp WHERE dp.user_id = u.id AND dp.status = 'active'), 0) AS domain_count,
		       u.suspended_at, u.suspended_reason
		  FROM users u
		 WHERE u.id = $1
	`, id).Scan(
		&d.ID, &d.Email, &d.Name, &d.Role, &d.CreatedAt,
		&d.PhoneNumber, &d.Address,
		&d.City, &d.State,
		&d.PostalCode, &d.Nik,
		&d.EmailVerifiedAt,
		&d.ParentResellerID, &d.ResellerDisplayName,
		&d.ResellerStatus, &d.ResellerTier,
		&hasPassword, &hasGoogle,
		&d.SiteCount,
		&d.PublishedSites,
		&d.DomainCount,
		&d.SuspendedAt, &d.SuspendedReason,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	d.HasPasswordLogin = hasPassword
	d.HasGoogleLogin = hasGoogle
	return &d, nil
}

// UserSiteRow — site 1 user untuk admin detail page.
type UserSiteRow struct {
	ID        uuid.UUID `json:"id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ListUserSites — daftar sites yang di-own user tsb.
func (r *Repo) ListUserSites(ctx context.Context, userID uuid.UUID) ([]UserSiteRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, slug, name, status, created_at, updated_at
		  FROM sites
		 WHERE user_id = $1
		 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UserSiteRow{}
	for rows.Next() {
		var s UserSiteRow
		if err := rows.Scan(&s.ID, &s.Slug, &s.Name, &s.Status, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repo) UpdateUserRole(ctx context.Context, id uuid.UUID, role string) error {
	ct, err := r.pool.Exec(ctx, `UPDATE users SET role = $1, updated_at = now() WHERE id = $2`, role, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UserBrief is what the role/suspend guards need about the target account.
type UserBrief struct {
	Email     string
	Role      string
	Suspended bool
}

func (r *Repo) GetUserBrief(ctx context.Context, id uuid.UUID) (*UserBrief, error) {
	var b UserBrief
	err := r.pool.QueryRow(ctx,
		`SELECT email, role, suspended_at IS NOT NULL FROM users WHERE id = $1`, id,
	).Scan(&b.Email, &b.Role, &b.Suspended)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &b, err
}

// SuspendUser locks the account and revokes every refresh token in the same
// transaction, so the lock cannot land while a token survives to renew the
// session. suspended_at keeps its first value on a repeat call; the reason
// is updated.
func (r *Repo) SuspendUser(ctx context.Context, id, by uuid.UUID, reason string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx, `
		UPDATE users
		   SET suspended_at     = COALESCE(suspended_at, now()),
		       suspended_reason = $2,
		       suspended_by     = $3,
		       updated_at       = now()
		 WHERE id = $1`, id, reason, by)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repo) UnsuspendUser(ctx context.Context, id uuid.UUID) error {
	ct, err := r.pool.Exec(ctx, `
		UPDATE users
		   SET suspended_at = NULL, suspended_reason = '', suspended_by = NULL, updated_at = now()
		 WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) DeleteUser(ctx context.Context, id uuid.UUID) error {
	ct, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------- Sites ----------

type SiteRow struct {
	ID                   uuid.UUID `json:"id"`
	Slug                 string    `json:"slug"`
	Name                 string    `json:"name"`
	Status               string    `json:"status"`
	OwnerID              uuid.UUID `json:"owner_id"`
	OwnerEmail           string    `json:"owner_email"`
	PagesCount           int       `json:"pages_count"`
	AssetsCount          int       `json:"assets_count"`
	StorageBytes         int64     `json:"storage_bytes"`
	ProductsCount        int       `json:"products_count"`
	BlogPostsCount       int       `json:"blog_posts_count"`
	QuotaMaxPages        int       `json:"quota_max_pages"`
	QuotaMaxStorageBytes int64     `json:"quota_max_storage_bytes"`
	QuotaMaxProducts     int       `json:"quota_max_products"`
	QuotaMaxBlogPosts    int       `json:"quota_max_blog_posts"`
	CreatedAt            time.Time `json:"created_at"`
}

func orderSitesSQL(sort string) string {
	switch sort {
	case "storage_desc":
		return "storage_bytes DESC, s.created_at DESC"
	case "pages_desc":
		return "pages_count DESC, s.created_at DESC"
	case "name_asc":
		return "s.name ASC"
	case "oldest":
		return "s.created_at ASC"
	case "newest", "":
		return "s.created_at DESC"
	}
	return "s.created_at DESC"
}

// ListSitesPage filters by name/slug/owner email and supports presets sort.
func (r *Repo) ListSitesPage(ctx context.Context, like, sort string, limit, offset int) ([]SiteRow, int, error) {
	var total int
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM sites s
		JOIN users u ON u.id = s.user_id
		WHERE LOWER(s.name) LIKE $1
		   OR LOWER(s.slug) LIKE $1
		   OR LOWER(u.email) LIKE $1
	`, like).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := fmt.Sprintf(`
		SELECT s.id, s.slug, s.name, s.status,
		       s.user_id, u.email,
		       COALESCE(p.cnt, 0)   AS pages_count,
		       COALESCE(a.cnt, 0)   AS assets_count,
		       COALESCE(a.bytes, 0) AS storage_bytes,
		       COALESCE(pr.cnt, 0)  AS products_count,
		       COALESCE(bp.cnt, 0)  AS blog_posts_count,
		       s.quota_max_pages, s.quota_max_storage_bytes,
		       s.quota_max_products, s.quota_max_blog_posts,
		       s.created_at
		FROM sites s
		JOIN users u ON u.id = s.user_id
		LEFT JOIN (SELECT site_id, COUNT(*) AS cnt FROM pages GROUP BY site_id) p ON p.site_id = s.id
		LEFT JOIN (SELECT site_id, COUNT(*) AS cnt, COALESCE(SUM(size), 0) AS bytes FROM assets GROUP BY site_id) a ON a.site_id = s.id
		LEFT JOIN (SELECT site_id, COUNT(*) AS cnt FROM products GROUP BY site_id) pr ON pr.site_id = s.id
		LEFT JOIN (SELECT site_id, COUNT(*) AS cnt FROM blog_posts GROUP BY site_id) bp ON bp.site_id = s.id
		WHERE LOWER(s.name) LIKE $1
		   OR LOWER(s.slug) LIKE $1
		   OR LOWER(u.email) LIKE $1
		ORDER BY %s
		LIMIT $2 OFFSET $3
	`, orderSitesSQL(sort))

	rows, err := r.pool.Query(ctx, q, like, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []SiteRow{}
	for rows.Next() {
		var s SiteRow
		if err := rows.Scan(
			&s.ID, &s.Slug, &s.Name, &s.Status,
			&s.OwnerID, &s.OwnerEmail,
			&s.PagesCount, &s.AssetsCount, &s.StorageBytes,
			&s.ProductsCount, &s.BlogPostsCount,
			&s.QuotaMaxPages, &s.QuotaMaxStorageBytes,
			&s.QuotaMaxProducts, &s.QuotaMaxBlogPosts,
			&s.CreatedAt,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, s)
	}
	return out, total, rows.Err()
}

func (r *Repo) UpdateSiteQuota(ctx context.Context, id uuid.UUID, maxPages *int, maxStorageBytes *int64, maxProducts, maxBlogPosts *int) error {
	ct, err := r.pool.Exec(ctx, `
		UPDATE sites SET
		    quota_max_pages         = COALESCE($2, quota_max_pages),
		    quota_max_storage_bytes = COALESCE($3, quota_max_storage_bytes),
		    quota_max_products      = COALESCE($4, quota_max_products),
		    quota_max_blog_posts    = COALESCE($5, quota_max_blog_posts),
		    updated_at              = now()
		WHERE id = $1
	`, id, maxPages, maxStorageBytes, maxProducts, maxBlogPosts)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) DeleteSite(ctx context.Context, id uuid.UUID) error {
	ct, err := r.pool.Exec(ctx, `DELETE FROM sites WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------- Stats ----------

type Stats struct {
	// User & role breakdown
	UserCount        int `json:"user_count"`
	AdminCount       int `json:"admin_count"`
	ActiveResellers  int `json:"active_resellers"`
	TotalAgents      int `json:"total_agents"`
	ManagedClients   int `json:"managed_clients"`

	// Site & content
	SiteCount      int `json:"site_count"`
	PublishedSites int `json:"published_sites"`
	PageCount      int `json:"page_count"`

	// Custom hostname (tabel domains) — SSL / DNS mapping
	CustomHostnames  int `json:"custom_hostnames"`
	VerifiedDomains  int `json:"verified_domains"`

	// Registered domains (tabel registered_domains) — EPP-owned domain
	RegisteredDomains int `json:"registered_domains"`
	ExpiringIn30Days  int `json:"expiring_30d"`

	// Financial
	TotalRevenueIDR      int64 `json:"total_revenue_idr"`
	RevenueThisMonthIDR  int64 `json:"revenue_this_month_idr"`
	UnpaidInvoices       int   `json:"unpaid_invoices"`
	TotalWalletBalanceIDR int64 `json:"total_wallet_balance_idr"`

	// Actionable alerts — butuh admin intervention
	TopupsAwaitingReview      int `json:"topups_awaiting_review"`        // manual_bank + proof uploaded
	StuckPendingProvisioning  int `json:"stuck_pending_provisioning"`    // > 10 min in pending_provisioning
	FailedPurchasesToday      int `json:"failed_purchases_today"`

	// Assets & storage
	AssetCount        int   `json:"asset_count"`
	TotalStorageBytes int64 `json:"total_storage_bytes"`
}

func (r *Repo) PlatformStats(ctx context.Context) (Stats, error) {
	var s Stats
	// Kombinasi query — 1 roundtrip. Subquery per metric supaya NULL-safe
	// (COALESCE untuk SUM), dan filter status di WHERE bukan HAVING (index
	// friendly).
	err := r.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM users),
			(SELECT COUNT(*) FROM users WHERE role = 'admin'),
			(SELECT COUNT(*) FROM users WHERE role = 'reseller' AND reseller_status = 'active'),
			(SELECT COUNT(*) FROM users WHERE role = 'agent'),
			(SELECT COUNT(DISTINCT client_id) FROM client_assignments WHERE access_status != 'revoked'),

			(SELECT COUNT(*) FROM sites),
			(SELECT COUNT(*) FROM sites WHERE status = 'published'),
			(SELECT COUNT(*) FROM pages),

			(SELECT COUNT(*) FROM domains),
			(SELECT COUNT(*) FROM domains WHERE status = 'verified'),

			(SELECT COUNT(*) FROM registered_domains WHERE status = 'active'),
			(SELECT COUNT(*) FROM registered_domains
			  WHERE status = 'active' AND expires_at IS NOT NULL
			    AND expires_at <= now() + interval '30 days'),

			(SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status = 'paid'),
			(SELECT COALESCE(SUM(total), 0) FROM invoices
			  WHERE status = 'paid' AND paid_at >= date_trunc('month', now())),
			(SELECT COUNT(*) FROM invoices WHERE status = 'unpaid'),
			(SELECT COALESCE(SUM(balance), 0) FROM wallet_balances),

			(SELECT COUNT(*) FROM wallet_topups
			  WHERE status = 'pending_payment' AND proof_uploaded_at IS NOT NULL),
			(SELECT COUNT(*) FROM domain_purchases
			  WHERE status = 'pending_provisioning'
			    AND updated_at < now() - interval '10 minutes'),
			(SELECT COUNT(*) FROM domain_purchases
			  WHERE status = 'failed' AND created_at >= current_date),

			(SELECT COUNT(*) FROM assets),
			(SELECT COALESCE(SUM(size), 0) FROM assets)
	`).Scan(
		&s.UserCount, &s.AdminCount, &s.ActiveResellers, &s.TotalAgents, &s.ManagedClients,
		&s.SiteCount, &s.PublishedSites, &s.PageCount,
		&s.CustomHostnames, &s.VerifiedDomains,
		&s.RegisteredDomains, &s.ExpiringIn30Days,
		&s.TotalRevenueIDR, &s.RevenueThisMonthIDR, &s.UnpaidInvoices, &s.TotalWalletBalanceIDR,
		&s.TopupsAwaitingReview, &s.StuckPendingProvisioning, &s.FailedPurchasesToday,
		&s.AssetCount, &s.TotalStorageBytes,
	)
	if err != nil {
		return s, err
	}
	return s, nil
}

// silence unused
var _ = pgx.ErrNoRows

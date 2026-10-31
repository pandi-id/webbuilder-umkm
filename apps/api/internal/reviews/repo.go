// Package reviews stores buyer ratings for shop products. Submissions arrive on
// a public endpoint so they start as 'pending'; only rows the owner published
// are ever served to the storefront.
package reviews

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Review struct {
	ID            uuid.UUID  `json:"id"`
	SiteID        uuid.UUID  `json:"site_id"`
	ProductID     uuid.UUID  `json:"product_id"`
	Rating        int        `json:"rating"`
	AuthorName    string     `json:"author_name"`
	Body          string     `json:"body"`
	Status        string     `json:"status"`
	VerifiedBuyer bool       `json:"verified_buyer"`
	Reply         string     `json:"reply"`
	RepliedAt     *time.Time `json:"replied_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`

	// Joined for the dashboard inbox so the owner sees what was reviewed
	// without a second query. Empty on the public list.
	ProductName string `json:"product_name,omitempty"`
	ProductSlug string `json:"product_slug,omitempty"`
}

// Summary is the aggregate shown next to a product (storefront + card badge).
// Breakdown[0] counts 1-star reviews … Breakdown[4] counts 5-star ones. It is
// computed over every published review, not just the page the caller fetched,
// so the histogram always agrees with Count.
type Summary struct {
	Average   float64 `json:"average"` // 0 when there are no published reviews
	Count     int     `json:"count"`
	Breakdown [5]int  `json:"breakdown"`
}

const (
	StatusPending   = "pending"
	StatusPublished = "published"
	StatusRejected  = "rejected"
)

func ValidStatus(s string) bool {
	return s == StatusPending || s == StatusPublished || s == StatusRejected
}

var (
	ErrNotFound = errors.New("review not found")
	// ErrProductUnavailable covers both "no such product in this site" and
	// "product is not active" — the public caller must not tell them apart.
	ErrProductUnavailable = errors.New("product unavailable")
)

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

// author_phone is deliberately absent: nothing outside this package needs it.
const cols = `id, site_id, product_id, rating, author_name, body, status,
    verified_buyer, reply, replied_at, created_at, updated_at`

func scan(r *Review) []any {
	return []any{
		&r.ID, &r.SiteID, &r.ProductID, &r.Rating, &r.AuthorName, &r.Body, &r.Status,
		&r.VerifiedBuyer, &r.Reply, &r.RepliedAt, &r.CreatedAt, &r.UpdatedAt,
	}
}

type CreateInput struct {
	Rating     int
	AuthorName string
	// Normalized digits ("6281…") or empty. Used once to resolve the verified
	// badge, then kept only for the owner's own follow-up.
	AuthorPhone string
	Body        string
}

// CreateForSlug resolves the product by slug and inserts a pending review in
// one round trip. The verified-buyer flag is decided here, at submit time, so
// a later order (or a deleted one) can't retroactively change a published row.
func (r *Repo) CreateForSlug(ctx context.Context, siteID uuid.UUID, slug string, in CreateInput) (*Review, error) {
	var productID uuid.UUID
	err := r.pool.QueryRow(ctx,
		`SELECT id FROM products WHERE site_id = $1 AND slug = $2 AND status = 'active'`,
		siteID, slug,
	).Scan(&productID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrProductUnavailable
	}
	if err != nil {
		return nil, err
	}

	verified := false
	if in.AuthorPhone != "" {
		// Any past order from this phone in this shop counts; matching the
		// exact product would miss buyers who ordered several items at once.
		if err := r.pool.QueryRow(ctx,
			`SELECT EXISTS (
			     SELECT 1 FROM orders
			      WHERE site_id = $1 AND customer_phone = $2 AND status <> 'cancelled'
			 )`,
			siteID, in.AuthorPhone,
		).Scan(&verified); err != nil {
			return nil, err
		}
	}

	var out Review
	err = r.pool.QueryRow(ctx, `
		INSERT INTO product_reviews
		    (site_id, product_id, rating, author_name, author_phone, body, verified_buyer)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING `+cols,
		siteID, productID, in.Rating, in.AuthorName, in.AuthorPhone, in.Body, verified,
	).Scan(scan(&out)...)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ListPublished returns one product's approved reviews for the storefront.
func (r *Repo) ListPublished(ctx context.Context, siteID uuid.UUID, slug string, limit int) ([]Review, Summary, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var productID uuid.UUID
	err := r.pool.QueryRow(ctx,
		`SELECT id FROM products WHERE site_id = $1 AND slug = $2 AND status = 'active'`,
		siteID, slug,
	).Scan(&productID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, Summary{}, ErrProductUnavailable
	}
	if err != nil {
		return nil, Summary{}, err
	}

	rows, err := r.pool.Query(ctx,
		`SELECT `+cols+`
		   FROM product_reviews
		  WHERE product_id = $1 AND status = 'published'
		  ORDER BY created_at DESC
		  LIMIT $2`,
		productID, limit,
	)
	if err != nil {
		return nil, Summary{}, err
	}
	defer rows.Close()
	out := []Review{}
	for rows.Next() {
		var rv Review
		if err := rows.Scan(scan(&rv)...); err != nil {
			return nil, Summary{}, err
		}
		out = append(out, rv)
	}
	if err := rows.Err(); err != nil {
		return nil, Summary{}, err
	}

	s, err := r.SummaryForProduct(ctx, productID)
	if err != nil {
		return nil, Summary{}, err
	}
	return out, s, nil
}

func (r *Repo) SummaryForProduct(ctx context.Context, productID uuid.UUID) (Summary, error) {
	var s Summary
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(rating), 0)::float8,
		       COUNT(*),
		       COUNT(*) FILTER (WHERE rating = 1),
		       COUNT(*) FILTER (WHERE rating = 2),
		       COUNT(*) FILTER (WHERE rating = 3),
		       COUNT(*) FILTER (WHERE rating = 4),
		       COUNT(*) FILTER (WHERE rating = 5)
		  FROM product_reviews WHERE product_id = $1 AND status = 'published'`,
		productID,
	).Scan(&s.Average, &s.Count,
		&s.Breakdown[0], &s.Breakdown[1], &s.Breakdown[2], &s.Breakdown[3], &s.Breakdown[4])
	return s, err
}

// SummaryBySlug powers the rating badge on product cards and the detail page.
// Keyed by slug because that is what the renderer already has in hand.
func (r *Repo) SummaryBySlug(ctx context.Context, siteID uuid.UUID) (map[string]Summary, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT p.slug, COALESCE(AVG(rv.rating), 0)::float8, COUNT(rv.id)
		  FROM products p
		  JOIN product_reviews rv
		    ON rv.product_id = p.id AND rv.status = 'published'
		 WHERE p.site_id = $1
		 GROUP BY p.slug`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Summary{}
	for rows.Next() {
		var slug string
		var s Summary
		if err := rows.Scan(&slug, &s.Average, &s.Count); err != nil {
			return nil, err
		}
		out[slug] = s
	}
	return out, rows.Err()
}

// CountByStatus drives the moderation badge in the dashboard sidebar.
func (r *Repo) CountByStatus(ctx context.Context, siteID uuid.UUID, status string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM product_reviews WHERE site_id = $1 AND status = $2`,
		siteID, status,
	).Scan(&n)
	return n, err
}

func orderSQL(sort string) string {
	switch sort {
	case "oldest":
		return "rv.created_at ASC"
	case "rating_desc":
		return "rv.rating DESC, rv.created_at DESC"
	case "rating_asc":
		return "rv.rating ASC, rv.created_at DESC"
	default:
		return "rv.created_at DESC"
	}
}

// ListPage is the dashboard inbox: every status, joined with the product.
func (r *Repo) ListPage(ctx context.Context, siteID uuid.UUID, like, statusFilter, sort string, limit, offset int) ([]Review, int, error) {
	statusClause := ""
	args := []any{siteID, like}
	if statusFilter != "" {
		args = append(args, statusFilter)
		statusClause = fmt.Sprintf(" AND rv.status = $%d", len(args))
	}
	where := `rv.site_id = $1
	      AND (LOWER(rv.author_name) LIKE $2 OR LOWER(rv.body) LIKE $2 OR LOWER(p.name) LIKE $2)` + statusClause

	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM product_reviews rv JOIN products p ON p.id = rv.product_id WHERE `+where,
		args...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT rv.id, rv.site_id, rv.product_id, rv.rating, rv.author_name, rv.body,
		       rv.status, rv.verified_buyer, rv.reply, rv.replied_at,
		       rv.created_at, rv.updated_at, p.name, p.slug
		  FROM product_reviews rv
		  JOIN products p ON p.id = rv.product_id
		 WHERE %s
		 ORDER BY %s
		 LIMIT $%d OFFSET $%d`, where, orderSQL(sort), len(args)-1, len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Review{}
	for rows.Next() {
		var rv Review
		dest := append(scan(&rv), &rv.ProductName, &rv.ProductSlug)
		if err := rows.Scan(dest...); err != nil {
			return nil, 0, err
		}
		out = append(out, rv)
	}
	return out, total, rows.Err()
}

// GetOwned scopes by site so a review id from another shop can't be touched.
func (r *Repo) GetOwned(ctx context.Context, id, siteID uuid.UUID) (*Review, error) {
	var rv Review
	err := r.pool.QueryRow(ctx,
		`SELECT `+cols+` FROM product_reviews WHERE id = $1 AND site_id = $2`, id, siteID,
	).Scan(scan(&rv)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &rv, err
}

type UpdateInput struct {
	Status *string
	Reply  *string
}

func (r *Repo) Update(ctx context.Context, id, siteID uuid.UUID, in UpdateInput) (*Review, error) {
	// replied_at tracks when an answer first appeared; clearing the reply
	// clears it again so the UI never shows a timestamp with no text.
	var rv Review
	err := r.pool.QueryRow(ctx, `
		UPDATE product_reviews SET
		    status     = COALESCE($3, status),
		    reply      = COALESCE($4, reply),
		    replied_at = CASE
		        WHEN $4 IS NULL THEN replied_at
		        WHEN $4 = ''     THEN NULL
		        ELSE COALESCE(replied_at, now())
		    END,
		    updated_at = now()
		 WHERE id = $1 AND site_id = $2
		 RETURNING `+cols,
		id, siteID, in.Status, in.Reply,
	).Scan(scan(&rv)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &rv, err
}

func (r *Repo) Delete(ctx context.Context, id, siteID uuid.UUID) error {
	ct, err := r.pool.Exec(ctx, `DELETE FROM product_reviews WHERE id = $1 AND site_id = $2`, id, siteID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

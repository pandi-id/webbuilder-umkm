// Package orders stores UMKM shop checkouts. The cart lives in the buyer's
// browser; checkout posts it here, the seller follows up over WhatsApp and
// manages status from the dashboard. Payment happens off-platform.
package orders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/webbuilder/api/internal/sites"
)

var (
	ErrNotFound           = errors.New("order not found")
	ErrSiteNotFound       = errors.New("site not found or not published")
	ErrOutOfStock         = errors.New("out of stock")
	ErrProductUnavailable = errors.New("product unavailable")
	ErrInvalidTransition  = errors.New("invalid status transition")
	ErrMixedCurrency      = errors.New("mixed currency in cart")
)

// OutOfStockError matches ErrOutOfStock via errors.Is and carries what the
// buyer needs to fix the cart.
type OutOfStockError struct {
	Name      string
	Remaining int
}

func (e *OutOfStockError) Error() string {
	return fmt.Sprintf("out of stock: %s (remaining %d)", e.Name, e.Remaining)
}
func (e *OutOfStockError) Is(target error) bool { return target == ErrOutOfStock }

// ProductUnavailableError matches ErrProductUnavailable via errors.Is.
type ProductUnavailableError struct{ Slug string }

func (e *ProductUnavailableError) Error() string { return "product unavailable: " + e.Slug }
func (e *ProductUnavailableError) Is(target error) bool {
	return target == ErrProductUnavailable
}

// TransitionError matches ErrInvalidTransition via errors.Is.
type TransitionError struct{ From, To string }

func (e *TransitionError) Error() string { return "invalid transition " + e.From + " -> " + e.To }
func (e *TransitionError) Is(target error) bool {
	return target == ErrInvalidTransition
}

type OrderItem struct {
	ProductID uuid.UUID `json:"product_id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	Price     int64     `json:"price"`
	Qty       int       `json:"qty"`
	Subtotal  int64     `json:"subtotal"`
}

type Order struct {
	ID              uuid.UUID   `json:"id"`
	SiteID          uuid.UUID   `json:"site_id"`
	Seq             int         `json:"seq"`
	OrderNo         string      `json:"order_no"`
	Status          string      `json:"status"`
	CustomerName    string      `json:"customer_name"`
	CustomerPhone   string      `json:"customer_phone"`
	CustomerAddress string      `json:"customer_address"`
	Note            string      `json:"note"`
	Items           []OrderItem `json:"items"`
	Total           int64       `json:"total"`
	Currency        string      `json:"currency"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

// Line is one validated cart entry (duplicates already merged).
type Line struct {
	Slug string
	Qty  int
}

type CreateInput struct {
	Lines           []Line
	CustomerName    string
	CustomerPhone   string
	CustomerAddress string
	Note            string
}

// CreateResult bundles the order with the store info the renderer needs to
// open WhatsApp, read inside the same transaction.
type CreateResult struct {
	Order          *Order
	StoreName      string
	WhatsAppNumber string
}

type Summary struct {
	New         int          `json:"new"`
	Processing  int          `json:"processing"`
	Done        int          `json:"done"`
	Cancelled   int          `json:"cancelled"`
	RevenueDone int64        `json:"revenue_done"`
	WhatsApp    WhatsAppInfo `json:"whatsapp"`
}

// WhatsAppInfo is the number checkout actually sends buyers to.
// Source: "site" (shop-specific number), "profile" (owner's profile phone)
// or "" (none — orders are still recorded, buyers aren't redirected).
type WhatsAppInfo struct {
	Number  string `json:"number"`
	Source  string `json:"source"`
	Profile string `json:"profile"` // owner's profile phone (normalised), so the UI can offer it
}

// EffectiveWhatsApp prefers the shop's own number and falls back to the
// owner's profile phone, so sellers don't have to enter the same number twice.
func EffectiveWhatsApp(siteWA, ownerPhone string) (string, string) {
	if n, ok := sites.NormalizePhone(siteWA); ok && siteWA != "" {
		return n, "site"
	}
	if n, ok := sites.NormalizePhone(ownerPhone); ok && ownerPhone != "" {
		return n, "profile"
	}
	return "", ""
}

type ListFilter struct {
	Status      string // "" = all
	NamePattern string // LIKE pattern on LOWER(customer_name); "" disables
	PhoneLike   string // LIKE pattern on customer_phone; "" disables
	Seq         int    // exact seq match; 0 disables
	Search      bool   // false = no search predicate at all
	Sort        string
	Limit       int
	Offset      int
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

const orderCols = `id, site_id, seq, status, customer_name, customer_phone, customer_address,
    note, items_json, total, currency, created_at, updated_at`

func scanOrder(row pgx.Row) (*Order, error) {
	var o Order
	var items []byte
	if err := row.Scan(&o.ID, &o.SiteID, &o.Seq, &o.Status, &o.CustomerName, &o.CustomerPhone,
		&o.CustomerAddress, &o.Note, &items, &o.Total, &o.Currency, &o.CreatedAt, &o.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(items, &o.Items); err != nil || o.Items == nil {
		o.Items = []OrderItem{}
	}
	o.OrderNo = FormatOrderNo(o.Seq)
	return &o, nil
}

// orderOrdersSQL maps a sort preset to a fixed ORDER BY; user input never
// reaches the SQL text.
func orderOrdersSQL(preset string) string {
	switch preset {
	case "oldest":
		return "created_at ASC, seq ASC"
	case "total_desc":
		return "total DESC, created_at DESC"
	default: // newest
		return "created_at DESC, seq DESC"
	}
}

// Create checks out a cart atomically: stock is decremented with the
// server-side price snapshot, and any failure rolls back every line.
func (r *Repo) Create(ctx context.Context, siteID uuid.UUID, in CreateInput) (*CreateResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Locking the site row serialises checkouts per site, which makes the
	// MAX(seq)+1 allocation below race-free. NO KEY UPDATE keeps FK inserts
	// from other tables (pages, products) unblocked.
	var storeName, siteWA, ownerPhone, status string
	err = tx.QueryRow(ctx,
		`SELECT s.name, s.whatsapp_number, COALESCE(u.phone_number, ''), s.status
		   FROM sites s JOIN users u ON u.id = s.user_id
		  WHERE s.id = $1 FOR NO KEY UPDATE OF s`,
		siteID).Scan(&storeName, &siteWA, &ownerPhone, &status)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && status != "published") {
		return nil, ErrSiteNotFound
	}
	if err != nil {
		return nil, err
	}

	// Touch products in slug order so concurrent carts lock rows in the same
	// order (avoids deadlocks); output keeps the buyer's order.
	idx := make([]int, len(in.Lines))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return in.Lines[idx[a]].Slug < in.Lines[idx[b]].Slug })

	items := make([]OrderItem, len(in.Lines))
	currency := ""
	var total int64
	for _, i := range idx {
		line := in.Lines[i]
		var it OrderItem
		var cur string
		// stock NULL means unlimited; NULL - n stays NULL.
		err := tx.QueryRow(ctx, `
			UPDATE products
			   SET stock = stock - $3, updated_at = now()
			 WHERE site_id = $1 AND slug = $2 AND status = 'active'
			   AND (stock IS NULL OR stock >= $3)
			RETURNING id, name, price, currency`,
			siteID, line.Slug, line.Qty).Scan(&it.ProductID, &it.Name, &it.Price, &cur)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, r.explainMissing(ctx, tx, siteID, line.Slug)
		}
		if err != nil {
			return nil, err
		}
		if currency == "" {
			currency = cur
		} else if cur != currency {
			return nil, ErrMixedCurrency
		}
		it.Slug = line.Slug
		it.Qty = line.Qty
		it.Subtotal = it.Price * int64(line.Qty)
		total += it.Subtotal
		items[i] = it
	}

	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	o, err := scanOrder(tx.QueryRow(ctx, `
		INSERT INTO orders (site_id, seq, customer_name, customer_phone, customer_address,
		                    note, items_json, total, currency)
		VALUES ($1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM orders WHERE site_id = $1),
		        $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+orderCols,
		siteID, in.CustomerName, in.CustomerPhone, in.CustomerAddress, in.Note,
		itemsJSON, total, currency))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	wa, _ := EffectiveWhatsApp(siteWA, ownerPhone)
	return &CreateResult{Order: o, StoreName: storeName, WhatsAppNumber: wa}, nil
}

// explainMissing distinguishes "not enough stock" from "no such product"
// after the guarded UPDATE matched nothing.
func (r *Repo) explainMissing(ctx context.Context, tx pgx.Tx, siteID uuid.UUID, slug string) error {
	var name string
	var stock *int
	err := tx.QueryRow(ctx,
		`SELECT name, stock FROM products WHERE site_id = $1 AND slug = $2 AND status = 'active'`,
		siteID, slug).Scan(&name, &stock)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ProductUnavailableError{Slug: slug}
	}
	if err != nil {
		return err
	}
	if stock == nil {
		// Unlimited yet the UPDATE missed: only possible mid-race; treat as unavailable.
		return &ProductUnavailableError{Slug: slug}
	}
	return &OutOfStockError{Name: name, Remaining: max(*stock, 0)}
}

// GetByID loads an order without ownership scoping; callers must check the
// order's site against the caller before returning it.
func (r *Repo) GetByID(ctx context.Context, id uuid.UUID) (*Order, error) {
	o, err := scanOrder(r.pool.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func (r *Repo) ListBySite(ctx context.Context, siteID uuid.UUID, f ListFilter) ([]Order, int, error) {
	where := `
		WHERE site_id = $1
		  AND ($2 = '' OR status = $2)
		  AND (NOT $3::bool
		       OR ($4 <> '' AND LOWER(customer_name) LIKE $4)
		       OR ($5 <> '' AND customer_phone LIKE $5)
		       OR ($6 > 0 AND seq = $6))`
	args := []any{siteID, f.Status, f.Search, f.NamePattern, f.PhoneLike, f.Seq}

	var total int
	if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM orders`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+orderCols+` FROM orders`+where+
			` ORDER BY `+orderOrdersSQL(f.Sort)+` LIMIT $7 OFFSET $8`,
		append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *o)
	}
	return out, total, rows.Err()
}

func (r *Repo) SummaryBySite(ctx context.Context, siteID uuid.UUID) (*Summary, error) {
	var s Summary
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status = 'new'),
		       COUNT(*) FILTER (WHERE status = 'processing'),
		       COUNT(*) FILTER (WHERE status = 'done'),
		       COUNT(*) FILTER (WHERE status = 'cancelled'),
		       COALESCE(SUM(total) FILTER (WHERE status = 'done'), 0)
		  FROM orders WHERE site_id = $1`, siteID).
		Scan(&s.New, &s.Processing, &s.Done, &s.Cancelled, &s.RevenueDone)
	if err != nil {
		return nil, err
	}
	var siteWA, ownerPhone string
	err = r.pool.QueryRow(ctx, `
		SELECT s.whatsapp_number, COALESCE(u.phone_number, '')
		  FROM sites s JOIN users u ON u.id = s.user_id WHERE s.id = $1`, siteID).
		Scan(&siteWA, &ownerPhone)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	s.WhatsApp.Number, s.WhatsApp.Source = EffectiveWhatsApp(siteWA, ownerPhone)
	s.WhatsApp.Profile, _ = EffectiveWhatsApp("", ownerPhone)
	return &s, nil
}

// UpdateStatus applies a status transition; cancelling puts the reserved
// stock back in the same transaction.
func (r *Repo) UpdateStatus(ctx context.Context, id uuid.UUID, to string) (*Order, string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cur, err := scanOrder(tx.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id = $1 FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if !CanTransition(cur.Status, to) {
		return nil, cur.Status, &TransitionError{From: cur.Status, To: to}
	}

	if to == StatusCancelled {
		items := append([]OrderItem(nil), cur.Items...)
		sort.Slice(items, func(a, b int) bool { return items[a].Slug < items[b].Slug })
		for _, it := range items {
			if it.ProductID == uuid.Nil {
				continue
			}
			// Deleted products or ones switched to unlimited are simply skipped.
			if _, err := tx.Exec(ctx, `
				UPDATE products SET stock = stock + $3, updated_at = now()
				 WHERE id = $1 AND site_id = $2 AND stock IS NOT NULL`,
				it.ProductID, cur.SiteID, it.Qty); err != nil {
				return nil, "", err
			}
		}
	}

	o, err := scanOrder(tx.QueryRow(ctx,
		`UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING `+orderCols,
		id, to))
	if err != nil {
		return nil, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, "", err
	}
	return o, cur.Status, nil
}

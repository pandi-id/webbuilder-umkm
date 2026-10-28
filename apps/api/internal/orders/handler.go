package orders

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/webbuilder/api/internal/audit"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/metrics"
	"github.com/webbuilder/api/internal/sites"
)

type Handler struct {
	repo  *Repo
	sites *sites.Repo
	audit *audit.Repo // nil = status changes not audited
}

func NewHandler(repo *Repo, s *sites.Repo) *Handler { return &Handler{repo: repo, sites: s} }

// SetAudit injects the audit log post-construction (same pattern as admin).
func (h *Handler) SetAudit(a *audit.Repo) { h.audit = a }

func bumpCreated(result string) {
	metrics.Default.CounterInc("orders_created_total",
		"Public checkout attempts by outcome",
		map[string]string{"result": result})
}

// -------- Public checkout --------

// CreatePublic — POST /public/sites/:id/orders (no JWT, rate-limited per IP).
func (h *Handler) CreatePublic(c *fiber.Ctx) error {
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		bumpCreated("site_not_found")
		return httpx.Err(c, fiber.StatusNotFound, "site_not_found", "Toko tidak ditemukan.")
	}
	var req CreateRequest
	if err := c.BodyParser(&req); err != nil {
		bumpCreated("invalid")
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_json", "Format data pesanan tidak valid.")
	}

	// Honeypot: like forms, pretend success so bots learn nothing. Nothing is
	// stored and no stock moves.
	if strings.TrimSpace(req.HP) != "" {
		slog.Info("order create: honeypot triggered", "site_id", siteID, "ip", c.IP())
		bumpCreated("honeypot")
		now := time.Now().UTC()
		return httpx.Created(c, fiber.Map{
			"order": Order{
				ID: uuid.New(), SiteID: siteID, Seq: 0, OrderNo: FormatOrderNo(0),
				Status: StatusNew, CustomerName: strings.TrimSpace(req.Customer.Name),
				Items: []OrderItem{}, Currency: "IDR", CreatedAt: now, UpdatedAt: now,
			},
			"whatsapp_number": "",
			"store_name":      "",
		})
	}

	in, verr := req.Validate()
	if verr != nil {
		bumpCreated("invalid")
		return httpx.Err(c, fiber.StatusBadRequest, verr.Code, verr.Message)
	}

	res, err := h.repo.Create(c.Context(), siteID, in)
	if err != nil {
		var oos *OutOfStockError
		var pu *ProductUnavailableError
		switch {
		case errors.Is(err, ErrSiteNotFound):
			bumpCreated("site_not_found")
			return httpx.Err(c, fiber.StatusNotFound, "site_not_found", "Toko tidak ditemukan.")
		case errors.As(err, &oos):
			bumpCreated("out_of_stock")
			return httpx.Err(c, fiber.StatusConflict, "out_of_stock",
				fmt.Sprintf("Stok %s tidak cukup (tersisa %d).", oos.Name, oos.Remaining))
		case errors.As(err, &pu):
			bumpCreated("product_unavailable")
			return httpx.Err(c, fiber.StatusBadRequest, "product_unavailable",
				fmt.Sprintf("Produk %s tidak tersedia.", pu.Slug))
		case errors.Is(err, ErrMixedCurrency):
			bumpCreated("invalid")
			return httpx.Err(c, fiber.StatusBadRequest, "mixed_currency",
				"Produk di keranjang memakai mata uang berbeda. Pesan secara terpisah ya.")
		}
		slog.Error("order create failed", "site_id", siteID, "error", err)
		bumpCreated("error")
		return httpx.Internal(c, "Gagal menyimpan pesanan. Silakan coba lagi.")
	}
	bumpCreated("ok")

	wa := ""
	if res.WhatsAppNumber != "" {
		if n, ok := sites.NormalizePhone(res.WhatsAppNumber); ok {
			wa = n
		}
	}
	return httpx.Created(c, fiber.Map{
		"order":           res.Order,
		"whatsapp_number": wa,
		"store_name":      res.StoreName,
	})
}

// -------- Dashboard (JWT) --------

// ownedSite resolves :id and checks access. ok=false means the response has
// already been written (httpx helpers return nil, so a bool is the signal).
func (h *Handler) ownedSite(c *fiber.Ctx, siteID uuid.UUID) (bool, error) {
	_, err := h.sites.GetOwnedOrAdmin(c.Context(), siteID, auth.UserIDFrom(c), auth.IsAdminFrom(c))
	if errors.Is(err, sites.ErrNotFound) {
		return false, httpx.NotFound(c, "Situs tidak ditemukan.")
	}
	if err != nil {
		return false, httpx.Internal(c, "site lookup failed")
	}
	return true, nil
}

// ownedOrder loads :id and checks access via its site. Same ok contract as ownedSite.
func (h *Handler) ownedOrder(c *fiber.Ctx) (*Order, bool, error) {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return nil, false, httpx.NotFound(c, "Pesanan tidak ditemukan.")
	}
	o, err := h.repo.GetByID(c.Context(), id)
	if errors.Is(err, ErrNotFound) {
		return nil, false, httpx.NotFound(c, "Pesanan tidak ditemukan.")
	}
	if err != nil {
		return nil, false, httpx.Internal(c, "order lookup failed")
	}
	_, err = h.sites.GetOwnedOrAdmin(c.Context(), o.SiteID, auth.UserIDFrom(c), auth.IsAdminFrom(c))
	if errors.Is(err, sites.ErrNotFound) {
		// Same 404 as a missing order so IDs can't be probed across tenants.
		return nil, false, httpx.NotFound(c, "Pesanan tidak ditemukan.")
	}
	if err != nil {
		return nil, false, httpx.Internal(c, "site lookup failed")
	}
	return o, true, nil
}

// ListBySite — GET /api/v1/sites/:id/orders?page=&page_size=&q=&status=&sort=
func (h *Handler) ListBySite(c *fiber.Ctx) error {
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid site id")
	}
	if ok, err := h.ownedSite(c, siteID); !ok {
		return err
	}
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && !ValidStatus(status) {
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_status", "Filter status tidak valid.")
	}
	p := httpx.ParsePagination(c)
	f := searchFilter(p.Q, p.LikePattern())
	f.Status = status
	f.Sort = p.Sort
	f.Limit = p.PageSize
	f.Offset = p.Offset()

	items, total, err := h.repo.ListBySite(c.Context(), siteID, f)
	if err != nil {
		slog.Error("orders list failed", "site_id", siteID, "error", err)
		return httpx.Internal(c, "list failed")
	}
	return httpx.OK(c, httpx.MakePaginated(items, p, total))
}

// searchFilter turns ?q into name/phone/seq predicates. "#42" matches only
// order numbers; "0812…" also matches phones stored as "62812…".
func searchFilter(q, likePattern string) ListFilter {
	q = strings.TrimSpace(q)
	if q == "" {
		return ListFilter{}
	}
	f := ListFilter{Search: true}
	if strings.HasPrefix(q, "#") {
		f.Seq, _ = strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(q, "#")))
		return f
	}
	f.NamePattern = likePattern
	if n, err := strconv.Atoi(q); err == nil && n > 0 {
		f.Seq = n
	}
	var digits strings.Builder
	for _, r := range q {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	if d := digits.String(); d != "" {
		if strings.HasPrefix(d, "0") {
			d = "62" + d[1:]
		}
		f.PhoneLike = "%" + d + "%"
	}
	return f
}

// Summary — GET /api/v1/sites/:id/orders/summary
func (h *Handler) Summary(c *fiber.Ctx) error {
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid site id")
	}
	if ok, err := h.ownedSite(c, siteID); !ok {
		return err
	}
	s, err := h.repo.SummaryBySite(c.Context(), siteID)
	if err != nil {
		slog.Error("orders summary failed", "site_id", siteID, "error", err)
		return httpx.Internal(c, "summary failed")
	}
	return httpx.OK(c, s)
}

// Get — GET /api/v1/orders/:id
func (h *Handler) Get(c *fiber.Ctx) error {
	o, ok, err := h.ownedOrder(c)
	if !ok {
		return err
	}
	return httpx.OK(c, o)
}

type updateReq struct {
	Status string `json:"status"`
}

// Update — PATCH /api/v1/orders/:id {"status": "processing|done|cancelled"}
func (h *Handler) Update(c *fiber.Ctx) error {
	o, ok, err := h.ownedOrder(c)
	if !ok {
		return err
	}
	var req updateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	to := strings.TrimSpace(req.Status)
	switch to {
	case StatusProcessing, StatusDone, StatusCancelled:
	default:
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_status",
			"Status harus salah satu dari: processing, done, cancelled.")
	}

	updated, from, err := h.repo.UpdateStatus(c.Context(), o.ID, to)
	if errors.Is(err, ErrInvalidTransition) {
		return httpx.Err(c, fiber.StatusConflict, "invalid_transition", TransitionMessage(from, to))
	}
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "Pesanan tidak ditemukan.")
	}
	if err != nil {
		slog.Error("order status update failed", "order_id", o.ID, "error", err)
		return httpx.Internal(c, "update failed")
	}

	if h.audit != nil {
		actor := auth.UserIDFrom(c)
		ip, ua := strings.Clone(c.IP()), strings.Clone(c.Get("User-Agent")) // fiber reuses buffers after return
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = h.audit.Log(ctx, audit.Params{
				ActorID:    &actor,
				Event:      "order.status_changed",
				TargetType: "order",
				TargetID:   updated.ID.String(),
				Metadata: map[string]any{
					"site_id": updated.SiteID.String(),
					"from":    from,
					"to":      to,
				},
				IP:        ip,
				UserAgent: ua,
			})
		}()
	}
	return httpx.OK(c, updated)
}

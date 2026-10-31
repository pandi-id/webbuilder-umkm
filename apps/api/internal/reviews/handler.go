package reviews

import (
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/metrics"
	"github.com/webbuilder/api/internal/sites"
)

type Handler struct {
	repo  *Repo
	sites *sites.Repo
}

func NewHandler(r *Repo, s *sites.Repo) *Handler { return &Handler{repo: r, sites: s} }

const (
	maxAuthorName = 80
	maxBody       = 2000
	publicPageMax = 50
)

func bumpCreated(result string) {
	metrics.Default.CounterInc("product_reviews_created_total",
		"Public review submissions by outcome",
		map[string]string{"result": result})
}

// -------- Public (storefront) --------

type createReq struct {
	Rating     int    `json:"rating"`
	AuthorName string `json:"author_name"`
	Phone      string `json:"phone"`
	Body       string `json:"body"`
	HP         string `json:"_hp"` // honeypot
}

// publicReview is the storefront shape. It drops site/product ids and the
// moderation status so an approved review leaks nothing about the shop.
type publicReview struct {
	ID            uuid.UUID  `json:"id"`
	Rating        int        `json:"rating"`
	AuthorName    string     `json:"author_name"`
	Body          string     `json:"body"`
	VerifiedBuyer bool       `json:"verified_buyer"`
	Reply         string     `json:"reply"`
	RepliedAt     *time.Time `json:"replied_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

func toPublic(in []Review) []publicReview {
	out := make([]publicReview, 0, len(in))
	for _, r := range in {
		out = append(out, publicReview{
			ID: r.ID, Rating: r.Rating, AuthorName: r.AuthorName, Body: r.Body,
			VerifiedBuyer: r.VerifiedBuyer, Reply: r.Reply, RepliedAt: r.RepliedAt,
			CreatedAt: r.CreatedAt,
		})
	}
	return out
}

// CreatePublic — POST /public/sites/:id/products/:slug/reviews (no JWT, rate-limited).
func (h *Handler) CreatePublic(c *fiber.Ctx) error {
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		bumpCreated("product_unavailable")
		return httpx.Err(c, fiber.StatusNotFound, "product_unavailable", "Produk tidak ditemukan.")
	}
	var req createReq
	if err := c.BodyParser(&req); err != nil {
		bumpCreated("invalid")
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_json", "Format ulasan tidak valid.")
	}

	// Honeypot: same contract as forms/orders — report success, store nothing.
	if strings.TrimSpace(req.HP) != "" {
		slog.Info("review create: honeypot triggered", "site_id", siteID, "ip", c.IP())
		bumpCreated("honeypot")
		return httpx.Created(c, fiber.Map{"status": StatusPending})
	}

	if req.Rating < 1 || req.Rating > 5 {
		bumpCreated("invalid")
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_rating", "Beri bintang 1 sampai 5.")
	}
	name := strings.TrimSpace(req.AuthorName)
	if name == "" {
		bumpCreated("invalid")
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_name", "Nama wajib diisi.")
	}
	if len([]rune(name)) > maxAuthorName {
		bumpCreated("invalid")
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_name", "Nama terlalu panjang.")
	}
	body := strings.TrimSpace(req.Body)
	if len([]rune(body)) > maxBody {
		bumpCreated("invalid")
		return httpx.Err(c, fiber.StatusBadRequest, "invalid_body", "Ulasan terlalu panjang (maksimal 2000 karakter).")
	}

	// Phone is optional; a number we can't parse just means no verified badge.
	phone := ""
	if s := strings.TrimSpace(req.Phone); s != "" {
		if n, ok := sites.NormalizePhone(s); ok {
			phone = n
		}
	}

	rv, err := h.repo.CreateForSlug(c.Context(), siteID, c.Params("slug"), CreateInput{
		Rating: req.Rating, AuthorName: name, AuthorPhone: phone, Body: body,
	})
	if err != nil {
		if errors.Is(err, ErrProductUnavailable) {
			bumpCreated("product_unavailable")
			return httpx.Err(c, fiber.StatusNotFound, "product_unavailable", "Produk tidak ditemukan.")
		}
		slog.Error("review create failed", "error", err, "site_id", siteID)
		bumpCreated("error")
		return httpx.Internal(c, "Gagal menyimpan ulasan.")
	}

	bumpCreated("ok")
	// Status is echoed so the storefront can show the right confirmation.
	return httpx.Created(c, fiber.Map{"id": rv.ID, "status": rv.Status})
}

// ListPublic — GET /public/sites/:id/products/:slug/reviews
func (h *Handler) ListPublic(c *fiber.Ctx) error {
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.NotFound(c, "product not found")
	}
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	if limit <= 0 || limit > publicPageMax {
		limit = 20
	}
	items, summary, err := h.repo.ListPublished(c.Context(), siteID, c.Params("slug"), limit)
	if err != nil {
		if errors.Is(err, ErrProductUnavailable) {
			return httpx.NotFound(c, "product not found")
		}
		return httpx.Internal(c, "load failed")
	}
	return httpx.OK(c, fiber.Map{"items": toPublic(items), "summary": summary})
}

// SummaryPublic — GET /public/sites/:id/review-summary
// One call gives the renderer every product's rating, so a catalog grid does
// not fan out to one request per card.
func (h *Handler) SummaryPublic(c *fiber.Ctx) error {
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid site id")
	}
	m, err := h.repo.SummaryBySlug(c.Context(), siteID)
	if err != nil {
		return httpx.Internal(c, "load failed")
	}
	return httpx.OK(c, m)
}

// -------- Dashboard (owner) --------

func (h *Handler) ownedSite(c *fiber.Ctx) (uuid.UUID, error) {
	siteID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return uuid.Nil, errors.New("invalid site id")
	}
	if _, err := h.sites.GetOwnedOrAdmin(c.Context(), siteID, auth.UserIDFrom(c), auth.IsAdminFrom(c)); err != nil {
		return uuid.Nil, err
	}
	return siteID, nil
}

// ListBySite — GET /api/v1/sites/:id/reviews
func (h *Handler) ListBySite(c *fiber.Ctx) error {
	siteID, err := h.ownedSite(c)
	if err != nil {
		return httpx.NotFound(c, "site not found")
	}
	status := c.Query("status")
	if status != "" && !ValidStatus(status) {
		return httpx.BadRequest(c, "invalid status filter")
	}
	p := httpx.ParsePagination(c)
	items, total, err := h.repo.ListPage(c.Context(), siteID, p.LikePattern(), status, p.Sort, p.PageSize, p.Offset())
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	return httpx.OK(c, httpx.MakePaginated(items, p, total))
}

// Summary — GET /api/v1/sites/:id/reviews/summary (moderation badge).
func (h *Handler) Summary(c *fiber.Ctx) error {
	siteID, err := h.ownedSite(c)
	if err != nil {
		return httpx.NotFound(c, "site not found")
	}
	n, err := h.repo.CountByStatus(c.Context(), siteID, StatusPending)
	if err != nil {
		return httpx.Internal(c, "load failed")
	}
	return httpx.OK(c, fiber.Map{"pending": n})
}

type updateReq struct {
	Status *string `json:"status"`
	Reply  *string `json:"reply"`
}

// Update — PATCH /api/v1/sites/:id/reviews/:reviewId (approve / reject / reply).
func (h *Handler) Update(c *fiber.Ctx) error {
	siteID, err := h.ownedSite(c)
	if err != nil {
		return httpx.NotFound(c, "site not found")
	}
	reviewID, err := uuid.Parse(c.Params("reviewId"))
	if err != nil {
		return httpx.BadRequest(c, "invalid review id")
	}
	var req updateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	if req.Status != nil && !ValidStatus(*req.Status) {
		return httpx.BadRequest(c, "invalid status")
	}
	if req.Reply != nil {
		trimmed := strings.TrimSpace(*req.Reply)
		if len([]rune(trimmed)) > maxBody {
			return httpx.BadRequest(c, "reply too long")
		}
		req.Reply = &trimmed
	}
	rv, err := h.repo.Update(c.Context(), reviewID, siteID, UpdateInput{Status: req.Status, Reply: req.Reply})
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "review not found")
	}
	if err != nil {
		return httpx.Internal(c, "update failed")
	}
	return httpx.OK(c, rv)
}

// Delete — DELETE /api/v1/sites/:id/reviews/:reviewId
func (h *Handler) Delete(c *fiber.Ctx) error {
	siteID, err := h.ownedSite(c)
	if err != nil {
		return httpx.NotFound(c, "site not found")
	}
	reviewID, err := uuid.Parse(c.Params("reviewId"))
	if err != nil {
		return httpx.BadRequest(c, "invalid review id")
	}
	if err := h.repo.Delete(c.Context(), reviewID, siteID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "review not found")
		}
		return httpx.Internal(c, "delete failed")
	}
	return httpx.OK(c, fiber.Map{"deleted": true})
}

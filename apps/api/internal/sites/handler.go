package sites

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/httpx"
)

// CachePurger — interface minimal untuk dep injection cache purge.
// Sengaja di-declare di sini (bukan di cachepurge package) supaya sites
// tidak import cachepurge → menghindari import cycle (cachepurge →
// domain_purchase → sites). Konsumer inject concrete *cachepurge.Purger
// via SetPurger; interface memenuhi kontrak yang dibutuhkan.
type CachePurger interface {
	PurgeSite(ctx context.Context, siteID uuid.UUID)
	PurgePage(ctx context.Context, siteID uuid.UUID, slug string)
}

// AssetCleaner — hapus semua file storage (S3/local disk) milik site.
// DB row assets sudah cascade lewat FK, tapi FILE BYTES butuh cleanup
// eksplisit. Dipanggil FIRE-AND-FORGET dari Delete handler sebelum row
// site benar-benar hapus supaya URL asset masih bisa di-lookup dulu.
type AssetCleaner interface {
	CleanupSite(ctx context.Context, siteID uuid.UUID)
}

// TeamScopeResolver — resolve team member IDs (reseller + agent-agent nya).
// Dipakai `ListMyCollaborations` supaya reseller lihat sites yang agent nya
// bantu kelola. Nil = fallback ke caller-only scope.
type TeamScopeResolver interface {
	ListTeamActorIDs(ctx context.Context, callerID uuid.UUID) ([]uuid.UUID, error)
}

type Handler struct {
	repo         *Repo
	purger       CachePurger       // nil = purge no-op
	assetCleaner AssetCleaner      // nil = skip storage cleanup (dev tanpa storage)
	teamScope    TeamScopeResolver // nil = collaborations scoped ke caller saja
}

func NewHandler(r *Repo) *Handler { return &Handler{repo: r} }

// SetPurger inject cachepurge helper post-construction.
func (h *Handler) SetPurger(p CachePurger) { h.purger = p }

// SetAssetCleaner inject storage cleaner post-construction.
func (h *Handler) SetAssetCleaner(c AssetCleaner) { h.assetCleaner = c }

// SetTeamScope inject resolver untuk team-scoped collaboration list.
func (h *Handler) SetTeamScope(t TeamScopeResolver) { h.teamScope = t }

// slugRe = validasi kalau client kirim slug custom (opsional). Kalau tidak
// kirim, backend auto-generate via Slugify(name). Slug tidak lagi jadi URL
// user-facing (subdomain fallback sudah dihapus per konsep 1 domain = 1
// situs), tapi tetap disimpan sebagai identifier internal untuk backward
// compat + export folder naming.
var slugRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`)

type createReq struct {
	Slug       string          `json:"slug,omitempty"` // opsional — auto-generate kalau kosong
	Name       string          `json:"name"`
	TemplateID *uuid.UUID      `json:"template_id"`
	Theme      json.RawMessage `json:"theme"`
}

type updateReq struct {
	Name              *string         `json:"name"`
	Theme             json.RawMessage `json:"theme"`
	Layout            json.RawMessage `json:"layout"`
	Status            *string         `json:"status"`
	CustomHeadCode    *string         `json:"custom_head_code"`
	CustomBodyEndCode *string         `json:"custom_body_end_code"`
	WhatsAppNumber    *string         `json:"whatsapp_number"`
}

func (h *Handler) List(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	// Union: owned + collaborator (via site_members). Reseller/agent lihat
	// situs klien yang di-assign ke mereka; client tetap lihat cuma milik
	// sendiri (yang otomatis include mereka sebagai 'owner' role).
	out, err := h.repo.ListSitesAccessibleTo(c.Context(), uid)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	return httpx.OK(c, out)
}

func (h *Handler) Create(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	var req createReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return httpx.BadRequest(c, "name required")
	}
	// Slug opsional — auto-generate dari name kalau kosong. Kalau client
	// tetap kirim custom, validate format. Retry N kali dengan random suffix
	// kalau collision (slug tetap unique global untuk export folder naming).
	if req.Slug != "" && !slugRe.MatchString(req.Slug) {
		return httpx.BadRequest(c, "slug format tidak valid (huruf kecil, angka, hyphen, 2-40 char)")
	}
	if req.Slug == "" {
		req.Slug = Slugify(req.Name)
	}
	s, err := h.createWithSlugRetry(c, uid, req)
	if err != nil {
		return err
	}
	return httpx.Created(c, s)
}

// createWithSlugRetry try Create sampai 5x — kalau ErrSlugTaken (client tidak
// supply slug custom), tambah random suffix. Kalau client supply custom slug
// yang collision, tetap return 409 (biar user aware).
func (h *Handler) createWithSlugRetry(c *fiber.Ctx, uid uuid.UUID, req createReq) (*Site, error) {
	userSupplied := req.Slug != "" && strings.EqualFold(req.Slug, strings.TrimSpace(req.Slug))
	// Track intent: kalau req.Slug identik dengan Slugify(name), kita di-generate — bebas retry.
	generated := req.Slug == Slugify(req.Name)

	base := req.Slug
	for attempt := 0; attempt < 5; attempt++ {
		s, err := h.repo.Create(c.Context(), uid, req.Slug, req.Name, req.TemplateID, req.Theme)
		if err == nil {
			return s, nil
		}
		if errors.Is(err, ErrSlugTaken) {
			if !generated && userSupplied {
				return nil, httpx.Conflict(c, "slug already taken")
			}
			req.Slug = base + "-" + randomSuffix()
			continue
		}
		return nil, httpx.Internal(c, "create failed")
	}
	return nil, httpx.Internal(c, "gagal generate slug unik setelah 5 percobaan")
}

// Slugify convert nama ke URL-safe kebab-case. Contoh: "Toko Bahagia!" → "toko-bahagia".
// Kalau hasil kosong (nama semuanya non-alnum), fallback ke "site" + random suffix.
// Exported supaya paket lain (mis. templates) bisa reuse generator yang sama.
func Slugify(name string) string {
	s := strings.ToLower(name)
	// Ganti setiap run non-alnum jadi single hyphen.
	var b strings.Builder
	prevHyphen := true // hindari leading hyphen
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevHyphen = false
		} else if !prevHyphen {
			b.WriteRune('-')
			prevHyphen = true
		}
	}
	out := strings.TrimRight(b.String(), "-")
	if len(out) < 2 {
		return "site-" + randomSuffix()
	}
	if len(out) > 40 {
		out = out[:40]
		out = strings.TrimRight(out, "-")
	}
	return out
}

// randomSuffix — 6 char base36 (angka + huruf kecil). Cukup untuk cegah
// collision pada slug auto-generated tanpa bikin URL kepanjangan.
func randomSuffix() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = chars[randInt(len(chars))]
	}
	return string(b)
}

// randInt = math/rand di-abstract supaya bisa di-mock kalau perlu deterministic
// di test. Untuk suffix collision-avoidance, entropy math/rand cukup.
func randInt(n int) int {
	return int(uuid.New().ID() % uint32(n))
}

func (h *Handler) Get(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	// Admin bypass — supaya support/debug bisa buka editor site user.
	// Editor layout gunakan endpoint ini; kalau 404, layout clearTokens +
	// redirect ke /login. Sebelumnya admin non-member gagal disini.
	s, err := h.repo.GetOwnedOrAdmin(c.Context(), id, uid, auth.IsAdminFrom(c))
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "site not found")
	}
	if err != nil {
		return httpx.Internal(c, "load failed")
	}
	return httpx.OK(c, s)
}

func (h *Handler) Update(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	var req updateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	if req.Status != nil {
		switch *req.Status {
		case "draft", "published", "archived":
		default:
			return httpx.BadRequest(c, "invalid status")
		}
	}
	if req.CustomHeadCode != nil && len(*req.CustomHeadCode) > MaxCustomCodeBytes {
		return httpx.BadRequest(c, "custom head code melebihi 16 KB")
	}
	if req.CustomBodyEndCode != nil && len(*req.CustomBodyEndCode) > MaxCustomCodeBytes {
		return httpx.BadRequest(c, "custom body-end code melebihi 16 KB")
	}
	if req.WhatsAppNumber != nil && strings.TrimSpace(*req.WhatsAppNumber) != "" {
		wa, ok := NormalizePhone(*req.WhatsAppNumber)
		if !ok {
			return httpx.Err(c, fiber.StatusBadRequest, "invalid_whatsapp_number",
				"Nomor WhatsApp tidak valid. Contoh: 0812-3456-7890")
		}
		req.WhatsAppNumber = &wa
	} else if req.WhatsAppNumber != nil {
		empty := ""
		req.WhatsAppNumber = &empty
	}
	s, err := h.repo.UpdateOrAdmin(c.Context(), id, uid, UpdateFields{
		Name:              req.Name,
		Theme:             req.Theme,
		Layout:            req.Layout,
		Status:            req.Status,
		CustomHeadCode:    req.CustomHeadCode,
		CustomBodyEndCode: req.CustomBodyEndCode,
		WhatsAppNumber:    req.WhatsAppNumber,
	}, auth.IsAdminFrom(c))
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "site not found")
	}
	if err != nil {
		return httpx.Internal(c, "update failed")
	}
	return httpx.OK(c, s)
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	// Verify STRICT ownership — delete hanya boleh oleh sites.user_id.
	// Editor/collaborator TIDAK boleh delete (destructive, tidak reversible).
	if _, err := h.repo.GetStrictlyOwned(c.Context(), id, uid); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "site not found")
		}
		return httpx.Internal(c, "site lookup failed")
	}
	// Cleanup storage FILES sebelum row cascade — kalau kita delete DB dulu,
	// asset rows hilang dan URL tidak bisa di-lookup lagi. Fire-and-forget
	// goroutine di dalam CleanupSite (implementasi assets pkg) — tidak
	// block response. DB cascade (assets rows + forms + pages + dst.) tetap
	// jalan lewat h.repo.Delete di bawah.
	if h.assetCleaner != nil {
		h.assetCleaner.CleanupSite(c.Context(), id)
	}
	if err := h.repo.Delete(c.Context(), id, uid); errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "site not found")
	} else if err != nil {
		return httpx.Internal(c, "delete failed")
	}
	return httpx.OK(c, fiber.Map{"ok": true})
}

func (h *Handler) Publish(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	st := "published"
	s, err := h.repo.UpdateOrAdmin(c.Context(), id, uid, UpdateFields{Status: &st}, auth.IsAdminFrom(c))
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "site not found")
	}
	if err != nil {
		return httpx.Internal(c, "publish failed")
	}
	// Site publish = potensi banyak URL berubah (semua page live sekaligus).
	// Fire-and-forget purge_everything untuk zone terkait, biar edge cache
	// invalidate massal daripada per URL.
	if h.purger != nil {
		h.purger.PurgeSite(c.Context(), id)
	}
	return httpx.OK(c, s)
}

// ---------------- Site members (Phase 4 collab) ----------------

// ListMembers — GET /api/v1/sites/:id/members
// Owner, editor, dan viewer semua boleh lihat siapa saja yang punya akses.
func (h *Handler) ListMembers(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	// Admin bypass — support/debug perlu lihat siapa collab site user.
	if !auth.IsAdminFrom(c) {
		if _, err := h.repo.HasAccess(c.Context(), id, uid); err != nil {
			return httpx.NotFound(c, "site not found")
		}
	}
	members, err := h.repo.ListMembersForSite(c.Context(), id)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	type row struct {
		UserID  string `json:"user_id"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Role    string `json:"role"`
		AddedAt string `json:"added_at"`
	}
	out := make([]row, 0, len(members))
	for _, m := range members {
		out = append(out, row{
			UserID:  m.UserID.String(),
			Email:   m.Email,
			Name:    m.Name,
			Role:    m.Role,
			AddedAt: m.AddedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	return httpx.OK(c, out)
}

// RemoveMember — DELETE /api/v1/sites/:id/members/:user_id
// Hanya owner (strict) yang boleh remove collaborator. Owner tidak bisa
// di-remove via endpoint ini — perlu transfer ownership dulu.
func (h *Handler) RemoveMember(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	memberID, err := uuid.Parse(c.Params("user_id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid user_id")
	}
	// Strict-owner enforce — reseller/editor tidak boleh remove diri sendiri
	// via endpoint ini (bisa mereka pakai POST /leave nanti kalau perlu).
	if _, err := h.repo.GetStrictlyOwned(c.Context(), id, uid); err != nil {
		return httpx.NotFound(c, "site not found")
	}
	if err := h.repo.RemoveMember(c.Context(), id, memberID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "member tidak ditemukan atau adalah owner")
		}
		return httpx.Internal(c, "remove failed")
	}
	return httpx.OK(c, fiber.Map{"ok": true})
}

// ListMyCollaborations — GET /api/v1/collaborations
// Kebalikan dari /collaborators — return sites di mana caller (atau agent
// di bawahnya kalau caller reseller) adalah non-owner member. Include
// owner info supaya UI bisa tampil "editor di situs klien <nama>".
func (h *Handler) ListMyCollaborations(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	// Team scope: reseller lihat sites yang dia + agent-nya kelola.
	// Fallback ke caller-only kalau teamScope belum wired.
	actorIDs := []uuid.UUID{uid}
	if h.teamScope != nil {
		if team, err := h.teamScope.ListTeamActorIDs(c.Context(), uid); err == nil && len(team) > 0 {
			actorIDs = team
		}
	}
	items, err := h.repo.ListCollaborationsForActors(c.Context(), actorIDs)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	return httpx.OK(c, items)
}

// ListMyCollaborators — GET /api/v1/collaborators
// Halaman /settings/collaborators (client-side). Return semua non-owner
// member di sites yang caller own. Grouped by site di response supaya
// frontend tinggal render nested.
func (h *Handler) ListMyCollaborators(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	rows, err := h.repo.ListCollaboratorsOwnedBy(c.Context(), uid)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	// Group by site untuk output. Preserve order dari query (site name ASC).
	type collabRow struct {
		UserID  string `json:"user_id"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Role    string `json:"role"`
		AddedAt string `json:"added_at"`
	}
	type siteGroup struct {
		SiteID     string      `json:"site_id"`
		SiteName   string      `json:"site_name"`
		SiteSlug   string      `json:"site_slug"`
		Members    []collabRow `json:"members"`
	}
	groups := make(map[string]*siteGroup)
	order := []string{}
	for _, r := range rows {
		key := r.SiteID.String()
		g, ok := groups[key]
		if !ok {
			g = &siteGroup{
				SiteID:   key,
				SiteName: r.SiteName,
				SiteSlug: r.SiteSlug,
			}
			groups[key] = g
			order = append(order, key)
		}
		g.Members = append(g.Members, collabRow{
			UserID:  r.MemberID.String(),
			Email:   r.MemberEmail,
			Name:    r.MemberName,
			Role:    r.Role,
			AddedAt: r.AddedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	out := make([]siteGroup, 0, len(order))
	for _, k := range order {
		out = append(out, *groups[k])
	}
	return httpx.OK(c, out)
}

// LeaveSite — POST /api/v1/sites/:id/leave
// Collaborator (editor/viewer) mundur dari site. Owner tidak boleh leave.
// Dipakai reseller/agent setelah "handoff" ke client kalau tidak lagi terlibat.
func (h *Handler) LeaveSite(c *fiber.Ctx) error {
	uid := auth.UserIDFrom(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	if err := h.repo.RemoveMember(c.Context(), id, uid); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "Anda bukan collaborator (atau adalah owner) di site ini")
		}
		return httpx.Internal(c, "leave failed")
	}
	return httpx.OK(c, fiber.Map{"ok": true})
}

package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/templates"
)

// slugRe — kebab-case yang dipakai template slug. Mirror slug validator di
// sites package (huruf kecil + digit + hyphen, 2-40 char, tidak boleh leading/
// trailing hyphen).
var slugRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`)

// SetTemplates inject template repo pasca-construction — hindari cyclical
// dep di admin.NewHandler(). Nil-safe: kalau tidak di-inject, endpoint 503.
func (h *Handler) SetTemplates(r *templates.Repo) { h.templates = r }

// ListTemplates — GET /api/v1/admin/templates?status=&source=&search=&page=&page_size=
//
// Superset dari user-facing /templates: expose semua status + source untuk
// dashboard admin. Pagination + filter server-side.
func (h *Handler) ListTemplates(c *fiber.Ctx) error {
	if h.templates == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "templates_disabled",
			"Template repo belum di-wire.")
	}
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && status != templates.StatusDraft &&
		status != templates.StatusPublished && status != templates.StatusArchived {
		return httpx.BadRequest(c, "status filter tidak valid")
	}
	source := strings.TrimSpace(c.Query("source"))
	if source != "" && source != templates.SourceBuiltin && source != templates.SourceAdmin {
		return httpx.BadRequest(c, "source filter tidak valid")
	}
	search := strings.ToLower(strings.TrimSpace(c.Query("search")))

	page, _ := strconv.Atoi(c.Query("page", "1"))
	pageSize, _ := strconv.Atoi(c.Query("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}

	items, total, err := h.templates.ListForAdmin(c.Context(), templates.ListForAdminFilter{
		Status: status,
		Source: source,
		Search: search,
		Limit:  pageSize,
		Offset: (page - 1) * pageSize,
	})
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	totalPages := (total + pageSize - 1) / pageSize
	return httpx.OK(c, fiber.Map{
		"items":       items,
		"page":        page,
		"page_size":   pageSize,
		"total":       total,
		"total_pages": totalPages,
	})
}

// GetTemplate — GET /api/v1/admin/templates/:id
// Return full row termasuk pages_json + theme_json untuk editor.
func (h *Handler) GetTemplate(c *fiber.Ctx) error {
	if h.templates == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "templates_disabled",
			"Template repo belum di-wire.")
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	t, err := h.templates.GetByID(c.Context(), id)
	if errors.Is(err, templates.ErrNotFound) {
		return httpx.NotFound(c, "template tidak ditemukan")
	}
	if err != nil {
		return httpx.Internal(c, "lookup failed")
	}
	return httpx.OK(c, t)
}

// createTemplateReq — body untuk POST /admin/templates.
type createTemplateReq struct {
	Slug        string          `json:"slug"`
	Category    string          `json:"category"`
	Variant     string          `json:"variant"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	PreviewURL  string          `json:"preview_url"`
	Theme       json.RawMessage `json:"theme"`
	Pages       json.RawMessage `json:"pages"`
	IsPremium   bool            `json:"is_premium"`
	Status      string          `json:"status"` // default: draft
}

// CreateTemplate — POST /api/v1/admin/templates
func (h *Handler) CreateTemplate(c *fiber.Ctx) error {
	if h.templates == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "templates_disabled",
			"Template repo belum di-wire.")
	}
	var req createTemplateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	if err := validateTemplateMeta(req.Slug, req.Category, req.Variant, req.Name, req.Status); err != nil {
		return httpx.BadRequest(c, err.Error())
	}
	// Pages default `[]` supaya admin bisa create shell dulu lalu isi via
	// editor. Kalau di-supply, validate minimal structure.
	if req.Pages != nil && len(req.Pages) > 0 {
		if err := validatePagesJSON(req.Pages, req.Status); err != nil {
			return httpx.BadRequest(c, err.Error())
		}
	}

	t, err := h.templates.Create(c.Context(), templates.CreateInput{
		Slug:        req.Slug,
		Category:    req.Category,
		Variant:     req.Variant,
		Name:        strings.TrimSpace(req.Name),
		Description: strings.TrimSpace(req.Description),
		PreviewURL:  strings.TrimSpace(req.PreviewURL),
		Theme:       req.Theme,
		Pages:       req.Pages,
		IsPremium:   req.IsPremium,
		Status:      req.Status,
		CreatedBy:   auth.UserIDFrom(c),
	})
	if errors.Is(err, templates.ErrSlugTaken) {
		return httpx.Conflict(c, "slug sudah digunakan template lain")
	}
	if err != nil {
		return httpx.Internal(c, "create failed")
	}
	return httpx.Created(c, t)
}

// updateTemplateReq — body untuk PATCH /admin/templates/:id.
// Semua field opsional; nil = tidak diubah.
type updateTemplateReq struct {
	Slug                 *string         `json:"slug"`
	Category             *string         `json:"category"`
	Variant              *string         `json:"variant"`
	Name                 *string         `json:"name"`
	Description          *string         `json:"description"`
	PreviewURL           *string         `json:"preview_url"`
	PreviewScreenshotURL *string         `json:"preview_screenshot_url"`
	Theme                json.RawMessage `json:"theme"`
	Pages                json.RawMessage `json:"pages"`
	IsPremium            *bool           `json:"is_premium"`
	Status               *string         `json:"status"`
}

// UpdateTemplate — PATCH /api/v1/admin/templates/:id
func (h *Handler) UpdateTemplate(c *fiber.Ctx) error {
	if h.templates == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "templates_disabled",
			"Template repo belum di-wire.")
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	var req updateTemplateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	// Validate field yang di-set.
	if req.Slug != nil && !slugRe.MatchString(*req.Slug) {
		return httpx.BadRequest(c, "slug format invalid (huruf kecil, digit, hyphen, 2-40 char)")
	}
	if req.Category != nil && !templates.IsValidCategory(*req.Category) {
		return httpx.BadRequest(c, "category tidak valid")
	}
	if req.Variant != nil && !templates.IsValidVariant(*req.Variant) {
		return httpx.BadRequest(c, "variant tidak valid")
	}
	if req.Status != nil {
		s := *req.Status
		if s != templates.StatusDraft && s != templates.StatusPublished && s != templates.StatusArchived {
			return httpx.BadRequest(c, "status tidak valid")
		}
	}
	// Kalau admin publish (status=published), pages_json (yang final di DB)
	// harus valid — cek di sini kalau input punya Pages, atau kalau status
	// baru = published + no Pages provided, kita rely on DB (tidak re-fetch
	// untuk simplicity; nanti bisa strengthen).
	if req.Pages != nil && len(req.Pages) > 0 {
		wantStatus := ""
		if req.Status != nil {
			wantStatus = *req.Status
		}
		if err := validatePagesJSON(req.Pages, wantStatus); err != nil {
			return httpx.BadRequest(c, err.Error())
		}
	}

	t, err := h.templates.Update(c.Context(), id, templates.UpdateInput{
		Slug:                 req.Slug,
		Category:             req.Category,
		Variant:              req.Variant,
		Name:                 req.Name,
		Description:          req.Description,
		PreviewURL:           req.PreviewURL,
		PreviewScreenshotURL: req.PreviewScreenshotURL,
		Theme:                req.Theme,
		Pages:                req.Pages,
		IsPremium:            req.IsPremium,
		Status:               req.Status,
		UpdatedBy:            auth.UserIDFrom(c),
	})
	if errors.Is(err, templates.ErrNotFound) {
		return httpx.NotFound(c, "template tidak ditemukan")
	}
	if errors.Is(err, templates.ErrSlugTaken) {
		return httpx.Conflict(c, "slug sudah digunakan template lain")
	}
	if err != nil {
		return httpx.Internal(c, "update failed")
	}
	return httpx.OK(c, t)
}

// PublishTemplate — POST /api/v1/admin/templates/:id/publish
// Shorthand untuk PATCH status=published. Guard: tidak boleh publish kalau
// pages_json kosong (validate lookup dulu).
func (h *Handler) PublishTemplate(c *fiber.Ctx) error {
	return h.setTemplateStatus(c, templates.StatusPublished, true)
}

// ArchiveTemplate — POST /api/v1/admin/templates/:id/archive
func (h *Handler) ArchiveTemplate(c *fiber.Ctx) error {
	return h.setTemplateStatus(c, templates.StatusArchived, false)
}

// setTemplateStatus — helper untuk publish/archive.
// requirePages=true → cek pages_json non-empty sebelum flip.
func (h *Handler) setTemplateStatus(c *fiber.Ctx, status string, requirePages bool) error {
	if h.templates == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "templates_disabled",
			"Template repo belum di-wire.")
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	if requirePages {
		cur, err := h.templates.GetByID(c.Context(), id)
		if errors.Is(err, templates.ErrNotFound) {
			return httpx.NotFound(c, "template tidak ditemukan")
		}
		if err != nil {
			return httpx.Internal(c, "lookup failed")
		}
		if err := validatePagesJSON(cur.Pages, templates.StatusPublished); err != nil {
			return httpx.BadRequest(c, err.Error())
		}
	}
	t, err := h.templates.SetStatus(c.Context(), id, status, auth.UserIDFrom(c))
	if errors.Is(err, templates.ErrNotFound) {
		return httpx.NotFound(c, "template tidak ditemukan")
	}
	if err != nil {
		return httpx.Internal(c, "update status failed")
	}
	return httpx.OK(c, t)
}

// DeleteTemplate — DELETE /api/v1/admin/templates/:id
// Return 403 kalau source=builtin (repo enforce, kita map ke pesan friendly).
func (h *Handler) DeleteTemplate(c *fiber.Ctx) error {
	if h.templates == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "templates_disabled",
			"Template repo belum di-wire.")
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	err = h.templates.Delete(c.Context(), id)
	if errors.Is(err, templates.ErrNotFound) {
		return httpx.NotFound(c, "template tidak ditemukan")
	}
	if errors.Is(err, templates.ErrBuiltinProtected) {
		return httpx.Err(c, fiber.StatusForbidden, "builtin_protected",
			"Template built-in tidak boleh di-hapus. Duplicate dulu lalu edit copy-nya.")
	}
	if err != nil {
		return httpx.Internal(c, "delete failed")
	}
	return httpx.OK(c, fiber.Map{"ok": true})
}

// duplicateTemplateReq — body untuk POST /admin/templates/:id/duplicate.
type duplicateTemplateReq struct {
	NewSlug string `json:"new_slug"`
}

// DuplicateTemplate — POST /api/v1/admin/templates/:id/duplicate
// Copy row ke slug baru dengan source='admin', status='draft'. Dipakai fork
// builtin (edit copy-nya tanpa risk overwrite di startup).
func (h *Handler) DuplicateTemplate(c *fiber.Ctx) error {
	if h.templates == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "templates_disabled",
			"Template repo belum di-wire.")
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return httpx.BadRequest(c, "invalid id")
	}
	var req duplicateTemplateReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.NewSlug = strings.ToLower(strings.TrimSpace(req.NewSlug))
	if !slugRe.MatchString(req.NewSlug) {
		return httpx.BadRequest(c, "new_slug format invalid (huruf kecil, digit, hyphen, 2-40 char)")
	}
	t, err := h.templates.Duplicate(c.Context(), id, req.NewSlug, auth.UserIDFrom(c))
	if errors.Is(err, templates.ErrNotFound) {
		return httpx.NotFound(c, "template asal tidak ditemukan")
	}
	if errors.Is(err, templates.ErrSlugTaken) {
		return httpx.Conflict(c, "new_slug sudah digunakan template lain")
	}
	if err != nil {
		return httpx.Internal(c, "duplicate failed")
	}
	return httpx.Created(c, t)
}

// -------- Validation helpers --------

func validateTemplateMeta(slug, category, variant, name, status string) error {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if !slugRe.MatchString(slug) {
		return errors.New("slug format invalid (huruf kecil, digit, hyphen, 2-40 char)")
	}
	if !templates.IsValidCategory(category) {
		return errors.New("category tidak valid — pakai: school, umkm, portfolio, blog, landing, other")
	}
	if !templates.IsValidVariant(variant) {
		return errors.New("variant tidak valid — pakai: modern, clean, professional")
	}
	if strings.TrimSpace(name) == "" {
		return errors.New("name wajib diisi")
	}
	if status != "" && status != templates.StatusDraft &&
		status != templates.StatusPublished && status != templates.StatusArchived {
		return errors.New("status tidak valid — pakai: draft, published, archived")
	}
	return nil
}

// validatePagesJSON — parse minimal shape + enforce "min 1 home page" kalau
// mau publish. Draft boleh empty (admin sedang build).
func validatePagesJSON(raw json.RawMessage, wantStatus string) error {
	if len(raw) == 0 {
		if wantStatus == templates.StatusPublished {
			return errors.New("template publish butuh minimal 1 page dengan is_home=true")
		}
		return nil
	}
	var pages []struct {
		Slug   string `json:"slug"`
		IsHome bool   `json:"is_home"`
	}
	if err := json.Unmarshal(raw, &pages); err != nil {
		return errors.New("pages harus array of {slug, title, tree, seo, is_home}")
	}
	if wantStatus == templates.StatusPublished {
		if len(pages) == 0 {
			return errors.New("template publish butuh minimal 1 page")
		}
		homeCount := 0
		for _, p := range pages {
			if p.IsHome {
				homeCount++
			}
		}
		if homeCount == 0 {
			return errors.New("template publish butuh 1 page dengan is_home=true")
		}
		if homeCount > 1 {
			return errors.New("hanya boleh 1 page dengan is_home=true")
		}
	}
	return nil
}

// -------- Thumbnail upload (Phase 7) --------

// UploadThumbnailResp — response setelah upload sukses. URL langsung bisa
// di-set ke `templates.preview_url` via PATCH biasa (frontend handles this).
type UploadThumbnailResp struct {
	URL string `json:"url"`
}

// allowedThumbMime — mirror allowedMime di assets pkg tapi lokal supaya tidak
// tergantung export. Raster-only, no SVG (XSS via inline script).
var allowedThumbMime = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// Max 5 MiB — thumbnail cukup di bawah ini. Aggressive limit karena
// dashboard admin akan tampil banyak thumbnail sekaligus.
const maxThumbBytes = 5 * 1024 * 1024

// UploadTemplateThumbnail — POST /api/v1/admin/templates/thumbnail
// Multipart field "file". Return { url } yang bisa admin paste ke
// `preview_url` field template (via UI: auto-set setelah upload).
//
// Storage key: `template-thumbnails/<random>.<ext>` — flat namespace supaya
// tidak butuh template_id (upload BISA sebelum template dibuat).
func (h *Handler) UploadTemplateThumbnail(c *fiber.Ctx) error {
	if h.storage == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "storage_disabled",
			"Asset storage belum di-konfigurasi.")
	}

	fh, err := c.FormFile("file")
	if err != nil {
		return httpx.BadRequest(c, "field 'file' wajib (multipart)")
	}
	if fh.Size > maxThumbBytes {
		return httpx.BadRequest(c, "file terlalu besar (max 5 MB)")
	}

	// MIME detection — trust header dulu, fallback ke ekstensi.
	mime := fh.Header.Get("Content-Type")
	ext := ""
	if e, ok := allowedThumbMime[mime]; ok {
		ext = e
	} else {
		// Fallback ke ekstensi filename.
		switch strings.ToLower(filepath.Ext(fh.Filename)) {
		case ".png":
			mime, ext = "image/png", ".png"
		case ".jpg", ".jpeg":
			mime, ext = "image/jpeg", ".jpg"
		case ".webp":
			mime, ext = "image/webp", ".webp"
		case ".gif":
			mime, ext = "image/gif", ".gif"
		}
	}
	if ext == "" {
		return httpx.BadRequest(c, "format file harus PNG, JPG, WebP, atau GIF (bukan SVG)")
	}

	src, err := fh.Open()
	if err != nil {
		return httpx.Internal(c, "buka file gagal")
	}
	defer src.Close()

	// Random 16-byte hex — cukup untuk avoid collision + tidak leak path.
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return httpx.Internal(c, "random error")
	}
	key := "template-thumbnails/" + hex.EncodeToString(buf) + ext

	url, err := h.storage.Put(c.Context(), key, src, fh.Size, mime)
	if err != nil {
		return httpx.Internal(c, "upload failed: "+err.Error())
	}

	// Audit — track admin yang upload untuk trace.
	h.logAudit(c.Context(), auth.UserIDFrom(c),
		"template.thumbnail_uploaded", "template", "", map[string]any{
			"filename": fh.Filename,
			"size":     fh.Size,
			"mime":     mime,
			"url":      url,
		})

	return httpx.OK(c, UploadThumbnailResp{URL: url})
}

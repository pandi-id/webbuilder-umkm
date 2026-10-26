package templates

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/webbuilder/api/internal/sites"
)

type Template struct {
	ID                   uuid.UUID       `json:"id"`
	Slug                 string          `json:"slug"`
	Category             string          `json:"category"`
	Variant              string          `json:"variant"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	PreviewURL           string          `json:"preview_url"`
	PreviewScreenshotURL string          `json:"preview_screenshot_url"`
	Theme                json.RawMessage `json:"theme"`
	Pages                json.RawMessage `json:"pages"`
	IsPremium            bool            `json:"is_premium"`
	Status               string          `json:"status"` // draft | published | archived
	Source               string          `json:"source"` // builtin | admin
	CreatedBy            *uuid.UUID      `json:"created_by,omitempty"`
	UpdatedBy            *uuid.UUID      `json:"updated_by,omitempty"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
}

// Status + Source enums (mirror string di DB — enforce di app layer).
const (
	StatusDraft     = "draft"
	StatusPublished = "published"
	StatusArchived  = "archived"

	SourceBuiltin = "builtin"
	SourceAdmin   = "admin"
)

// Validation enums.
var validCategories = map[string]bool{
	"school":    true,
	"umkm":      true,
	"portfolio": true,
	"blog":      true,
	"landing":   true,
	"other":     true,
}

var validVariants = map[string]bool{
	"modern":       true,
	"clean":        true,
	"professional": true,
}

func IsValidCategory(c string) bool { return validCategories[c] }
func IsValidVariant(v string) bool  { return validVariants[v] }

// ErrBuiltinProtected — dikembalikan saat admin coba delete row source=builtin.
var ErrBuiltinProtected = errors.New("builtin template cannot be deleted")

// ErrSlugTaken — race condition di Create/Duplicate.
var ErrSlugTaken = errors.New("slug already taken")

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

var ErrNotFound = errors.New("not found")

// selectCols kept sync dengan `scanArgs` — every list/get query pakai constant
// yang sama biar tambah kolom baru cukup 1 tempat.
const selectCols = `id, slug, category, variant, name, description,
	preview_url, preview_screenshot_url, theme_json, pages_json, is_premium,
	status, source, created_by, updated_by, created_at, updated_at`

func scanArgs(t *Template) []any {
	return []any{
		&t.ID, &t.Slug, &t.Category, &t.Variant, &t.Name, &t.Description,
		&t.PreviewURL, &t.PreviewScreenshotURL, &t.Theme, &t.Pages, &t.IsPremium,
		&t.Status, &t.Source, &t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
	}
}

// List — user-facing: hanya status='published'. Dipakai wizard klien +
// dashboard list. Draft + archived tersembunyi.
func (r *Repo) List(ctx context.Context) ([]Template, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+selectCols+`
		  FROM templates
		 WHERE status = 'published'
		 ORDER BY category, variant, name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Template{}
	for rows.Next() {
		var t Template
		if err := rows.Scan(scanArgs(&t)...); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repo) GetBySlug(ctx context.Context, slug string) (*Template, error) {
	var t Template
	err := r.pool.QueryRow(ctx, `
		SELECT `+selectCols+`
		  FROM templates WHERE slug = $1
	`, slug).Scan(scanArgs(&t)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &t, err
}

// GetByID — lookup by primary key. Dipakai admin CRUD (edit by id supaya
// slug bisa di-rename tanpa lookup lama ambigu).
func (r *Repo) GetByID(ctx context.Context, id uuid.UUID) (*Template, error) {
	var t Template
	err := r.pool.QueryRow(ctx, `
		SELECT `+selectCols+`
		  FROM templates WHERE id = $1
	`, id).Scan(scanArgs(&t)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &t, err
}

// ApplyMode controls what ApplyToSite changes.
type ApplyMode string

const (
	// ApplyModeTheme only swaps theme tokens (colors/fonts/radius). Pages untouched.
	ApplyModeTheme ApplyMode = "theme"
	// ApplyModeAppend swaps theme AND inserts template pages whose slugs aren't taken.
	ApplyModeAppend ApplyMode = "append"
	// ApplyModeReplace swaps theme AND wipes existing pages, then inserts template pages.
	ApplyModeReplace ApplyMode = "replace"
)

// ApplyResult reports what ApplyToSite did, for UI feedback.
type ApplyResult struct {
	Mode          ApplyMode `json:"mode"`
	Template      string    `json:"template_slug"`
	PagesInserted int       `json:"pages_inserted"`
	PagesSkipped  int       `json:"pages_skipped"`
	PagesRemoved  int       `json:"pages_removed"`
}

// ApplyToSite swaps the theme of an existing site to another template's, and
// optionally seeds template pages. Runs in a transaction — partial failures
// roll back. Caller must verify ownership before calling.
func (r *Repo) ApplyToSite(ctx context.Context, siteID uuid.UUID, slug string, mode ApplyMode) (*ApplyResult, error) {
	tpl, err := r.GetBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Always swap theme + link site to the new template id.
	if _, err := tx.Exec(ctx,
		`UPDATE sites SET theme_json = $1, template_id = $2, updated_at = now() WHERE id = $3`,
		tpl.Theme, tpl.ID, siteID,
	); err != nil {
		return nil, err
	}

	res := &ApplyResult{Mode: mode, Template: tpl.Slug}

	// Untuk mode Replace, extract shared header/footer dari template pages
	// dulu → set ke sites.layout_json. Mode Append TIDAK extract (kalau site
	// existing sudah punya layout sendiri, tidak boleh di-timpa; extraction
	// hanya aman saat replace/create).
	pagesRaw := tpl.Pages
	if mode == ApplyModeReplace {
		layoutJSON, stripped, extractErr := sites.ExtractLayoutFromPagesJSON(tpl.Pages)
		if extractErr == nil {
			if len(layoutJSON) > 0 {
				if _, err := tx.Exec(ctx,
					`UPDATE sites SET layout_json = $2, updated_at = now() WHERE id = $1`,
					siteID, layoutJSON,
				); err != nil {
					return nil, err
				}
			}
			pagesRaw = stripped
		}
	}

	switch mode {
	case ApplyModeTheme:
		// nothing else
	case ApplyModeAppend, ApplyModeReplace:
		// parse template pages JSON
		var tplPages []struct {
			Slug   string          `json:"slug"`
			Title  string          `json:"title"`
			IsHome bool            `json:"is_home"`
			Tree   json.RawMessage `json:"tree"`
			SEO    json.RawMessage `json:"seo"`
		}
		if len(pagesRaw) > 0 {
			_ = json.Unmarshal(pagesRaw, &tplPages)
		}

		if mode == ApplyModeReplace {
			ct, err := tx.Exec(ctx, `DELETE FROM pages WHERE site_id = $1`, siteID)
			if err != nil {
				return nil, err
			}
			res.PagesRemoved = int(ct.RowsAffected())
		}

		// Existing slug set — for "append" we skip collisions.
		existing := map[string]bool{}
		hasHome := false
		if mode == ApplyModeAppend {
			rows, err := tx.Query(ctx, `SELECT slug, is_home FROM pages WHERE site_id = $1`, siteID)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var s string
				var h bool
				if err := rows.Scan(&s, &h); err != nil {
					rows.Close()
					return nil, err
				}
				existing[s] = true
				if h {
					hasHome = true
				}
			}
			rows.Close()
		}

		for _, p := range tplPages {
			if p.Slug == "" {
				continue
			}
			if mode == ApplyModeAppend && existing[p.Slug] {
				res.PagesSkipped++
				continue
			}
			tree := p.Tree
			if len(tree) == 0 {
				tree = json.RawMessage(`{}`)
			}
			seo := p.SEO
			if len(seo) == 0 {
				seo = json.RawMessage(`{}`)
			}
			isHome := p.IsHome
			// Don't promote two homes when appending into a site that already has one.
			if mode == ApplyModeAppend && hasHome {
				isHome = false
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO pages (site_id, slug, title, tree_json, seo_json, is_home)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, siteID, p.Slug, p.Title, tree, seo, isHome); err != nil {
				return nil, err
			}
			res.PagesInserted++
		}
	default:
		return nil, errors.New("invalid mode")
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return res, nil
}

// -------- Admin CRUD (plan-admin-templates.md Phase 1) --------

// ListForAdminFilter — kolom filter untuk /admin/templates list.
type ListForAdminFilter struct {
	Status string // "" = all
	Source string // "" = all
	Search string // ILIKE match di slug + name
	Limit  int
	Offset int
}

// ListForAdmin — return SEMUA status (draft + published + archived + builtin +
// admin). Berbeda dari `List` yang filter published-only untuk client wizard.
func (r *Repo) ListForAdmin(ctx context.Context, f ListForAdminFilter) ([]Template, int, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	where := []string{"1=1"}
	args := []any{}
	i := 1
	add := func(clause string, val any) {
		where = append(where, clause+" $"+itoa(i))
		args = append(args, val)
		i++
	}
	if f.Status != "" {
		add("status =", f.Status)
	}
	if f.Source != "" {
		add("source =", f.Source)
	}
	if s := f.Search; s != "" {
		like := "%" + s + "%"
		where = append(where, "(LOWER(slug) LIKE $"+itoa(i)+" OR LOWER(name) LIKE $"+itoa(i)+")")
		args = append(args, like)
		i++
	}
	whereSQL := ""
	for j, w := range where {
		if j == 0 {
			whereSQL = w
		} else {
			whereSQL += " AND " + w
		}
	}

	var total int
	if err := r.pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM templates WHERE "+whereSQL, args...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	dataArgs := append(append([]any{}, args...), limit, f.Offset)
	rows, err := r.pool.Query(ctx, `
		SELECT `+selectCols+`
		  FROM templates
		 WHERE `+whereSQL+`
		 ORDER BY updated_at DESC
		 LIMIT $`+itoa(i)+` OFFSET $`+itoa(i+1),
		dataArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Template{}
	for rows.Next() {
		var t Template
		if err := rows.Scan(scanArgs(&t)...); err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, rows.Err()
}

// CreateInput — payload untuk admin `Create`.
type CreateInput struct {
	Slug        string
	Category    string
	Variant     string
	Name        string
	Description string
	PreviewURL  string
	Theme       json.RawMessage
	Pages       json.RawMessage
	IsPremium   bool
	Status      string    // default: draft kalau kosong
	CreatedBy   uuid.UUID // admin yang trigger
}

// Create — insert row baru dengan source='admin'. Default status='draft'
// supaya admin bisa staging sebelum publish.
func (r *Repo) Create(ctx context.Context, in CreateInput) (*Template, error) {
	status := in.Status
	if status == "" {
		status = StatusDraft
	}
	if in.Theme == nil || len(in.Theme) == 0 {
		in.Theme = json.RawMessage(`{}`)
	}
	if in.Pages == nil || len(in.Pages) == 0 {
		in.Pages = json.RawMessage(`[]`)
	}
	var t Template
	err := r.pool.QueryRow(ctx, `
		INSERT INTO templates
			(slug, category, variant, name, description, preview_url,
			 theme_json, pages_json, is_premium, status, source, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'admin', $11, $11)
		RETURNING `+selectCols,
		in.Slug, in.Category, in.Variant, in.Name, in.Description, in.PreviewURL,
		in.Theme, in.Pages, in.IsPremium, status, in.CreatedBy,
	).Scan(scanArgs(&t)...)
	if pgErrCode(err) == "23505" {
		return nil, ErrSlugTaken
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateInput — semua field opsional (nil = skip via COALESCE).
type UpdateInput struct {
	Slug                 *string
	Category             *string
	Variant              *string
	Name                 *string
	Description          *string
	PreviewURL           *string
	PreviewScreenshotURL *string
	Theme                json.RawMessage // nil = skip; empty {} = set to {}
	Pages                json.RawMessage
	IsPremium            *bool
	Status               *string
	UpdatedBy            uuid.UUID
}

// Update — PATCH semantic. Field yang nil di input di-preserve via COALESCE.
// Slug rename allowed asal tidak konflik.
func (r *Repo) Update(ctx context.Context, id uuid.UUID, in UpdateInput) (*Template, error) {
	var t Template
	err := r.pool.QueryRow(ctx, `
		UPDATE templates SET
			slug                    = COALESCE($2, slug),
			category                = COALESCE($3, category),
			variant                 = COALESCE($4, variant),
			name                    = COALESCE($5, name),
			description             = COALESCE($6, description),
			preview_url             = COALESCE($7, preview_url),
			preview_screenshot_url  = COALESCE($8, preview_screenshot_url),
			theme_json              = COALESCE($9, theme_json),
			pages_json              = COALESCE($10, pages_json),
			is_premium              = COALESCE($11, is_premium),
			status                  = COALESCE($12, status),
			updated_by              = $13,
			updated_at              = now()
		WHERE id = $1
		RETURNING `+selectCols,
		id, in.Slug, in.Category, in.Variant, in.Name, in.Description,
		in.PreviewURL, in.PreviewScreenshotURL, in.Theme, in.Pages,
		in.IsPremium, in.Status, in.UpdatedBy,
	).Scan(scanArgs(&t)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if pgErrCode(err) == "23505" {
		return nil, ErrSlugTaken
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// SetStatus — publish/archive/back-to-draft. Shorthand untuk Update yang
// cuma set status.
func (r *Repo) SetStatus(ctx context.Context, id uuid.UUID, status string, updatedBy uuid.UUID) (*Template, error) {
	return r.Update(ctx, id, UpdateInput{Status: &status, UpdatedBy: updatedBy})
}

// Delete — hard delete. Return ErrBuiltinProtected kalau source='builtin'
// (admin harus duplicate dulu baru delete copy-nya).
func (r *Repo) Delete(ctx context.Context, id uuid.UUID) error {
	// Guard: lookup dulu supaya bisa cek source. Race window kecil (admin
	// tidak concurrent-nya kejar), acceptable.
	var source string
	err := r.pool.QueryRow(ctx, `SELECT source FROM templates WHERE id = $1`, id).Scan(&source)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if source == SourceBuiltin {
		return ErrBuiltinProtected
	}
	ct, err := r.pool.Exec(ctx, `DELETE FROM templates WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Duplicate — copy template ke row baru dengan slug baru + source='admin'.
// Dipakai admin untuk fork built-in template.
//
// Slug baru dari caller (admin ketik di dialog). Kalau konflik → ErrSlugTaken,
// admin bisa retry dengan slug lain.
func (r *Repo) Duplicate(ctx context.Context, sourceID uuid.UUID, newSlug string, createdBy uuid.UUID) (*Template, error) {
	orig, err := r.GetByID(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	return r.Create(ctx, CreateInput{
		Slug:        newSlug,
		Category:    orig.Category,
		Variant:     orig.Variant,
		Name:        orig.Name + " (copy)",
		Description: orig.Description,
		PreviewURL:  orig.PreviewURL,
		Theme:       orig.Theme,
		Pages:       orig.Pages,
		IsPremium:   orig.IsPremium,
		Status:      StatusDraft, // duplicate selalu mulai sebagai draft
		CreatedBy:   createdBy,
	})
}

// pgErrCode extract SQLState dari pgx error.
func pgErrCode(err error) string {
	type pgErr interface{ SQLState() string }
	if e, ok := err.(pgErr); ok {
		return e.SQLState()
	}
	return ""
}

// itoa small positional-arg helper.
func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	if n < 100 {
		return string(rune('0'+n/10)) + string(rune('0'+n%10))
	}
	return string(rune('0'+n/100)) + string(rune('0'+(n/10)%10)) + string(rune('0'+n%10))
}

// Seed populates the built-in templates: 12 dari matrix (4 categories × 3
// variants).
// Idempotent: re-running upserts by slug.
func (r *Repo) Seed(ctx context.Context) error {
	for _, t := range BuiltinTemplates() {
		theme, err := json.Marshal(t.Theme)
		if err != nil {
			return err
		}
		pages, err := json.Marshal(t.Pages)
		if err != nil {
			return err
		}
		_, err = r.pool.Exec(ctx, `
			INSERT INTO templates
				(slug, category, variant, name, description, preview_url,
				 theme_json, pages_json, status, source)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', 'builtin')
			ON CONFLICT (slug) DO UPDATE SET
			    category    = EXCLUDED.category,
			    variant     = EXCLUDED.variant,
			    name        = EXCLUDED.name,
			    description = EXCLUDED.description,
			    preview_url = EXCLUDED.preview_url,
			    theme_json  = EXCLUDED.theme_json,
			    pages_json  = EXCLUDED.pages_json,
			    -- Force source='builtin' — kalau admin sempat edit + set source='admin',
			    -- restart tetap identify sebagai builtin (source of truth = source code).
			    source      = 'builtin',
			    updated_at  = now()
		`, t.Slug, t.Category, t.Variant, t.Name, t.Description, t.PreviewURL, theme, pages)
		if err != nil {
			return err
		}
	}
	return nil
}

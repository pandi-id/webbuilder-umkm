package sites

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Site membership roles — mirror string enum di migration 0028.
const (
	RoleOwner  = "owner"  // pemilik situs (sites.user_id)
	RoleEditor = "editor" // full edit (block editor, publish)
	RoleViewer = "viewer" // read-only (untuk analytics-only akses)
)

// Member = 1 row site_members. Berisi user_id + role dalam site tertentu.
type Member struct {
	ID      uuid.UUID
	SiteID  uuid.UUID
	UserID  uuid.UUID
	Role    string
	AddedBy *uuid.UUID
	AddedAt time.Time
}

// MemberWithProfile = Member + join users untuk display di UI (nama + email).
type MemberWithProfile struct {
	Member
	Email string
	Name  string
}

// EnsureOwner idempotent-insert owner row untuk site + user tsb. Dipanggil
// setelah `sites.Create` — pastikan tiap site punya row owner (backward compat
// migration 0028 sudah seed existing sites; ini cover site baru).
//
// ON CONFLICT DO NOTHING karena unique (site_id, user_id) constraint. Bila
// row sudah exist dengan role lain (shouldn't happen), no-op.
func (r *Repo) EnsureOwner(ctx context.Context, siteID, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO site_members (site_id, user_id, role)
		VALUES ($1, $2, 'owner')
		ON CONFLICT (site_id, user_id) DO NOTHING
	`, siteID, userID)
	return err
}

// AddMember insert row site_members. Dipakai saat reseller/agent auto-added
// sebagai editor post-purchase, atau saat client invite collaborator manual.
// Duplicate (site_id, user_id) → update role (upgrade owner > editor > viewer
// via caller check, disini flat overwrite).
func (r *Repo) AddMember(ctx context.Context, siteID, userID uuid.UUID, role string, addedBy *uuid.UUID) error {
	if role != RoleOwner && role != RoleEditor && role != RoleViewer {
		return errors.New("invalid role")
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO site_members (site_id, user_id, role, added_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (site_id, user_id) DO UPDATE SET
		    role     = EXCLUDED.role,
		    added_by = EXCLUDED.added_by
	`, siteID, userID, role, addedBy)
	return err
}

// RemoveMember delete site_members row. Return ErrNotFound kalau tidak ada
// atau kalau row itu adalah owner (owner tidak bisa di-remove — perlu delete
// site kalau owner leave).
func (r *Repo) RemoveMember(ctx context.Context, siteID, userID uuid.UUID) error {
	ct, err := r.pool.Exec(ctx,
		`DELETE FROM site_members WHERE site_id = $1 AND user_id = $2 AND role != 'owner'`,
		siteID, userID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// HasAccess check apakah userID punya akses ke siteID dengan salah satu role
// yang di-allow. Return role kalau match, "" + ErrNotFound kalau tidak.
//
// Pattern pemakaian:
//
//	role, err := repo.HasAccess(ctx, siteID, userID, RoleOwner, RoleEditor)
//	if err != nil { return 404 }
//	// editor+owner-only endpoint
func (r *Repo) HasAccess(ctx context.Context, siteID, userID uuid.UUID, allowed ...string) (string, error) {
	if len(allowed) == 0 {
		allowed = []string{RoleOwner, RoleEditor, RoleViewer}
	}
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT role FROM site_members
		  WHERE site_id = $1 AND user_id = $2 AND role = ANY($3)
		  LIMIT 1`,
		siteID, userID, allowed,
	).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}

// GetAccessible ambil Site kalau userID punya akses (owner/editor/viewer).
// Superset dari GetOwned yang hanya cek sites.user_id — dipakai untuk
// endpoint yang boleh diakses collaborator (mis. GET /sites/:id/pages).
//
// Filter role opsional: kalau kosong, semua role boleh. Kalau di-set,
// hanya role yang match di-return.
func (r *Repo) GetAccessible(ctx context.Context, siteID, userID uuid.UUID, allowed ...string) (*Site, error) {
	if len(allowed) == 0 {
		allowed = []string{RoleOwner, RoleEditor, RoleViewer}
	}
	var s Site
	err := r.pool.QueryRow(ctx, `
		SELECT `+siteCols+`
		  FROM sites
		 WHERE id = $1
		   AND id IN (
		       SELECT site_id FROM site_members
		        WHERE user_id = $2 AND role = ANY($3)
		   )
	`, siteID, userID, allowed).Scan(scanArgs(&s)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// ListMembersForSite — semua member 1 site, dengan user profile (email + name)
// untuk display. Owner selalu row pertama (ORDER BY role='owner' DESC).
func (r *Repo) ListMembersForSite(ctx context.Context, siteID uuid.UUID) ([]MemberWithProfile, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT sm.id, sm.site_id, sm.user_id, sm.role, sm.added_by, sm.added_at,
		       u.email, u.name
		  FROM site_members sm
		  JOIN users u ON u.id = sm.user_id
		 WHERE sm.site_id = $1
		 ORDER BY (sm.role = 'owner') DESC, sm.added_at ASC
	`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MemberWithProfile{}
	for rows.Next() {
		var m MemberWithProfile
		if err := rows.Scan(
			&m.ID, &m.SiteID, &m.UserID, &m.Role, &m.AddedBy, &m.AddedAt,
			&m.Email, &m.Name,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListSitesAccessibleTo — semua sites di mana userID adalah member (role apapun).
// Dipakai untuk dashboard reseller/agent supaya sites klien muncul di list mereka.
//
// Superset dari ListByUser (owner-only). Kalau ingin exclude sites yang
// user-owned, filter di caller (rare need).
func (r *Repo) ListSitesAccessibleTo(ctx context.Context, userID uuid.UUID, allowed ...string) ([]SiteWithRole, error) {
	if len(allowed) == 0 {
		allowed = []string{RoleOwner, RoleEditor, RoleViewer}
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+sitePrefixedCols("s")+`, sm.role
		  FROM sites s
		  JOIN site_members sm ON sm.site_id = s.id
		 WHERE sm.user_id = $1 AND sm.role = ANY($2)
		 ORDER BY s.created_at DESC
	`, userID, allowed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Init empty slice (bukan nil) supaya JSON output `[]` bukan `null` —
	// frontend `sites.length` bergantung ini.
	out := []SiteWithRole{}
	for rows.Next() {
		var s SiteWithRole
		if err := rows.Scan(append(scanArgs(&s.Site), &s.Role)...); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SiteWithRole = Site + role caller di site tsb. Dipakai list "sites saya
// akses" (mix owned + collaborator).
type SiteWithRole struct {
	Site
	Role string `json:"role"`
}

// SiteCollaboration = 1 row untuk halaman "situs yang saya bantu kelola"
// (agent/reseller view). Include owner info + role caller supaya UI bisa
// tampilkan "editor dari <klien>".
type SiteCollaboration struct {
	SiteID     uuid.UUID `json:"site_id"`
	SiteName   string    `json:"site_name"`
	SiteSlug   string    `json:"site_slug"`
	OwnerID    uuid.UUID `json:"owner_id"`
	OwnerEmail string    `json:"owner_email"`
	OwnerName  string    `json:"owner_name"`
	Role       string    `json:"role"` // 'editor' | 'viewer'
	// Site state, so the collaborator can tell a live shop from a draft
	// without opening each one. Hostname is the verified custom domain, empty
	// while none is connected.
	SiteStatus string    `json:"site_status"`
	Hostname   string    `json:"hostname"`
	UpdatedAt  time.Time `json:"updated_at"`
	AddedAt    time.Time `json:"added_at"`
}

// ListMyCollaborations — sites di mana userID adalah non-owner member.
// Kebalikan dari ListCollaboratorsOwnedBy: return dari sudut pandang
// COLLABORATOR (bukan owner). Dipakai agent/reseller portal untuk lihat
// situs klien yang mereka bantu kelola.
func (r *Repo) ListMyCollaborations(ctx context.Context, userID uuid.UUID) ([]SiteCollaboration, error) {
	return r.ListCollaborationsForActors(ctx, []uuid.UUID{userID})
}

// ListCollaborationsForActors — sites di mana salah satu actorIDs adalah
// non-owner member. Team-scope variant untuk reseller portal supaya lihat
// juga situs yang agent-agent nya bantu kelola.
func (r *Repo) ListCollaborationsForActors(ctx context.Context, actorIDs []uuid.UUID) ([]SiteCollaboration, error) {
	if len(actorIDs) == 0 {
		return []SiteCollaboration{}, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT s.id, s.name, s.slug,
		       s.user_id, COALESCE(ou.email, ''), COALESCE(ou.name, ''),
		       sm.role, sm.added_at,
		       s.status, COALESCE(d.hostname, ''), s.updated_at
		  FROM sites s
		  JOIN site_members sm ON sm.site_id = s.id
		  LEFT JOIN users ou ON ou.id = s.user_id
		  -- Verified domain only; a pending one is not reachable yet. LATERAL
		  -- keeps it to one row per site even with several hostnames.
		  LEFT JOIN LATERAL (
		       SELECT hostname FROM domains
		        WHERE site_id = s.id AND status = 'verified'
		        ORDER BY created_at ASC LIMIT 1
		  ) d ON true
		 WHERE sm.user_id = ANY($1) AND sm.role <> 'owner'
		 ORDER BY s.name ASC
	`, actorIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SiteCollaboration{}
	for rows.Next() {
		var c SiteCollaboration
		if err := rows.Scan(
			&c.SiteID, &c.SiteName, &c.SiteSlug,
			&c.OwnerID, &c.OwnerEmail, &c.OwnerName,
			&c.Role, &c.AddedAt,
			&c.SiteStatus, &c.Hostname, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CollaboratorAccess = 1 row untuk halaman /settings/collaborators (client-side).
// Query: semua site yang owned by userID + semua non-owner member di dalamnya.
// Cross-join di SQL supaya bisa render nested list (per-site → list of collabs).
type CollaboratorAccess struct {
	SiteID      uuid.UUID
	SiteName    string
	SiteSlug    string
	MemberID    uuid.UUID
	MemberEmail string
	MemberName  string
	Role        string
	AddedAt     time.Time
}

// ListCollaboratorsOwnedBy — semua non-owner member di sites yang userID owns.
// Kalau caller reseller/agent, ini akan kosong (mereka bukan owner). Kalau
// caller client, return list untuk halaman /settings/collaborators.
func (r *Repo) ListCollaboratorsOwnedBy(ctx context.Context, ownerID uuid.UUID) ([]CollaboratorAccess, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT s.id, s.name, s.slug,
		       u.id, u.email, u.name,
		       sm.role, sm.added_at
		  FROM sites s
		  JOIN site_members sm ON sm.site_id = s.id AND sm.role <> 'owner'
		  JOIN users u ON u.id = sm.user_id
		 WHERE s.user_id = $1
		 ORDER BY s.name ASC, sm.added_at ASC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CollaboratorAccess{}
	for rows.Next() {
		var a CollaboratorAccess
		if err := rows.Scan(
			&a.SiteID, &a.SiteName, &a.SiteSlug,
			&a.MemberID, &a.MemberEmail, &a.MemberName,
			&a.Role, &a.AddedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

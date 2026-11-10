// Package reseller — repo + handler untuk operasi reseller/agent portal.
// Data isolation: semua query wajib scope by manager_id (reseller/agent yang
// login) supaya cross-tenant leak tidak mungkin.
package reseller

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/webbuilder/api/internal/auth"
)

// ClientAssignment — 1 row client_assignments.
type ClientAssignment struct {
	ID           uuid.UUID  `json:"id"`
	ManagerID    uuid.UUID  `json:"manager_id"`
	ClientID     uuid.UUID  `json:"client_id"`
	ManagerRole  string     `json:"manager_role"`  // 'reseller' | 'agent'
	AccessStatus string     `json:"access_status"` // 'setup' | 'active' | 'revoked'
	CreatedAt    time.Time  `json:"created_at"`
	HandedOffAt  *time.Time `json:"handed_off_at"`
	RevokedAt    *time.Time `json:"revoked_at"`
}

// ClientRow — payload untuk list-clients query dengan JOIN users (biar
// frontend bisa langsung display email + nama tanpa second-fetch).
type ClientRow struct {
	Assignment    ClientAssignment `json:"assignment"`
	Email         string           `json:"email"`
	Name          string           `json:"name"`
	CreatedAt     time.Time        `json:"created_at"`
	EmailVerified bool             `json:"email_verified"`
	// HasLogin is false only while the account still has no password and no
	// OAuth link — i.e. an invited placeholder that was never accepted. An
	// existing user added as a client has a login from day one, so "belum
	// accept" must not be inferred from EmailVerified alone.
	HasLogin bool `json:"has_login"`
	// DomainCount — jumlah domain aktif milik klien (semua register purchases
	// yang status=active). Dipakai frontend untuk hide "Beli Domain" button
	// kalau klien sudah punya domain.
	DomainCount int `json:"domain_count"`
}

// AgentRow — payload untuk list-agents. Agent = user role='agent' yang
// parent_reseller_id-nya = reseller yang login.
type AgentRow struct {
	ID              uuid.UUID  `json:"id"`
	Email           string     `json:"email"`
	Name            string     `json:"name"`
	CreatedAt       time.Time  `json:"created_at"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

var ErrNotFound = errors.New("not found")

// CreateAssignment insert 1 row (manager → client). UNIQUE constraint di DB
// prevent duplicate; kalau conflict return ErrAlreadyAssigned.
var ErrAlreadyAssigned = errors.New("client already assigned to this manager")

// AccessStatus constants — mirror string enum di DB.
const (
	AccessStatusSetup   = "setup"
	AccessStatusActive  = "active"
	AccessStatusRevoked = "revoked"
)

func (r *Repo) CreateAssignment(ctx context.Context, managerID, clientID uuid.UUID, managerRole string) (*ClientAssignment, error) {
	// (manager_id, client_id) is UNIQUE, so a previously revoked pairing would
	// collide forever and make an unlink irreversible. Reviving the row instead
	// keeps "lepas lalu tambahkan lagi" working; an assignment that is still
	// live is left untouched and reported as a conflict.
	var a ClientAssignment
	err := r.pool.QueryRow(ctx, `
		INSERT INTO client_assignments (manager_id, client_id, manager_role, access_status)
		VALUES ($1, $2, $3, 'setup')
		ON CONFLICT (manager_id, client_id) DO UPDATE
		   SET access_status = 'setup',
		       manager_role  = EXCLUDED.manager_role,
		       revoked_at    = NULL,
		       created_at    = now()
		 WHERE client_assignments.access_status = 'revoked'
		RETURNING id, manager_id, client_id, manager_role, access_status, created_at, handed_off_at, revoked_at
	`, managerID, clientID, managerRole).Scan(
		&a.ID, &a.ManagerID, &a.ClientID, &a.ManagerRole, &a.AccessStatus,
		&a.CreatedAt, &a.HandedOffAt, &a.RevokedAt,
	)
	if err != nil {
		// The WHERE on DO UPDATE filters out still-active pairings, so pgx sees
		// no returned row — that is the "already assigned" case.
		if errors.Is(err, pgx.ErrNoRows) || pgErrCode(err) == "23505" {
			return nil, ErrAlreadyAssigned
		}
		return nil, err
	}
	return &a, nil
}

// HasActiveAssignment — implementasi interface `domain_purchase.AssignmentChecker`.
// Return nil kalau valid, error non-nil (ErrNotFound) kalau tidak ada.
func (r *Repo) HasActiveAssignment(ctx context.Context, managerID, clientID uuid.UUID) error {
	_, err := r.FindActiveAssignmentBetween(ctx, managerID, clientID)
	return err
}

// ListManagedClientIDs — kembalikan semua client_id yang di-manage caller
// atau agent di bawahnya. Semantik team-scoped:
//   - caller reseller → direct clients + clients dari agent-agent nya
//   - caller agent    → direct clients saja
//
// Dipakai aggregate view (invoices, purchases) di reseller/agent portal.
func (r *Repo) ListManagedClientIDs(ctx context.Context, managerID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT ca.client_id
		  FROM client_assignments ca
		  LEFT JOIN users mgr ON mgr.id = ca.manager_id
		 WHERE ca.access_status != 'revoked'
		   AND (ca.manager_id = $1 OR mgr.parent_reseller_id = $1)
	`, managerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListTeamActorIDs — return caller.ID + agent-agent di bawah caller (kalau
// caller reseller). Untuk caller agent, return [callerID] saja. Dipakai
// aggregate view di reseller portal supaya invoice/purchase yang di-trigger
// agent (purchased_by=agent) juga muncul di reseller side.
func (r *Repo) ListTeamActorIDs(ctx context.Context, callerID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id FROM users
		 WHERE id = $1 OR (role = 'agent' AND parent_reseller_id = $1)
	`, callerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// FindActiveAssignmentBetween cek apakah managerID benar mengelola clientID.
// Return ErrNotFound kalau tidak ada / sudah revoked. Access status 'setup'
// (belum accept invite) tetap dianggap valid — reseller boleh beli domain
// duluan sebelum client aktifkan akun.
func (r *Repo) FindActiveAssignmentBetween(ctx context.Context, managerID, clientID uuid.UUID) (*ClientAssignment, error) {
	var a ClientAssignment
	err := r.pool.QueryRow(ctx, `
		SELECT id, manager_id, client_id, manager_role, access_status, created_at, handed_off_at, revoked_at
		  FROM client_assignments
		 WHERE manager_id = $1 AND client_id = $2 AND access_status != 'revoked'
		 ORDER BY created_at DESC LIMIT 1
	`, managerID, clientID).Scan(
		&a.ID, &a.ManagerID, &a.ClientID, &a.ManagerRole, &a.AccessStatus,
		&a.CreatedAt, &a.HandedOffAt, &a.RevokedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &a, err
}

// FindActiveAssignment cari assignment (client_id ke manager_id apapun).
// Dipakai check "email client sudah managed reseller lain?" — kalau ada
// dan bukan self, return conflict.
func (r *Repo) FindActiveAssignmentByClient(ctx context.Context, clientID uuid.UUID) (*ClientAssignment, error) {
	var a ClientAssignment
	err := r.pool.QueryRow(ctx, `
		SELECT id, manager_id, client_id, manager_role, access_status, created_at, handed_off_at, revoked_at
		  FROM client_assignments
		 WHERE client_id = $1 AND access_status != 'revoked'
		 ORDER BY created_at DESC LIMIT 1
	`, clientID).Scan(
		&a.ID, &a.ManagerID, &a.ClientID, &a.ManagerRole, &a.AccessStatus,
		&a.CreatedAt, &a.HandedOffAt, &a.RevokedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &a, err
}

// ListClientsByManager — reseller/agent lihat klien yang mereka kelola.
// Filter status 'setup'/'active' default (exclude revoked).
//
// Include COUNT domain aktif per klien (LEFT JOIN + subquery aggregate)
// supaya frontend bisa render CTA "Beli Domain" hanya kalau klien belum
// punya domain.
func (r *Repo) ListClientsByManager(ctx context.Context, managerID uuid.UUID) ([]ClientRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT ca.id, ca.manager_id, ca.client_id, ca.manager_role, ca.access_status,
		       ca.created_at, ca.handed_off_at, ca.revoked_at,
		       u.email, u.name, u.created_at, u.email_verified_at IS NOT NULL,
		       `+auth.HasLoginExpr("u")+`,
		       COALESCE(dc.cnt, 0) AS domain_count
		  FROM client_assignments ca
		  JOIN users u ON u.id = ca.client_id
		  LEFT JOIN (
		       SELECT user_id, COUNT(*) AS cnt
		         FROM domain_purchases
		        WHERE status = 'active' AND kind = 'register'
		        GROUP BY user_id
		  ) dc ON dc.user_id = ca.client_id
		 WHERE ca.manager_id = $1 AND ca.access_status != 'revoked'
		 ORDER BY ca.created_at DESC
	`, managerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClientRow{}
	for rows.Next() {
		var r ClientRow
		if err := rows.Scan(
			&r.Assignment.ID, &r.Assignment.ManagerID, &r.Assignment.ClientID,
			&r.Assignment.ManagerRole, &r.Assignment.AccessStatus,
			&r.Assignment.CreatedAt, &r.Assignment.HandedOffAt, &r.Assignment.RevokedAt,
			&r.Email, &r.Name, &r.CreatedAt, &r.EmailVerified, &r.HasLogin, &r.DomainCount,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RevokeAssignment unlinks a client from one manager. The user account is left
// alone on purpose: clients own their own sites and domains, and many signed up
// themselves before a reseller ever added them. Scoped by manager so one
// manager cannot drop another's client.
func (r *Repo) RevokeAssignment(ctx context.Context, managerID, clientID uuid.UUID) error {
	ct, err := r.pool.Exec(ctx, `
		UPDATE client_assignments
		   SET access_status = 'revoked', revoked_at = now()
		 WHERE manager_id = $1 AND client_id = $2 AND access_status != 'revoked'
	`, managerID, clientID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListAgentsByReseller — reseller lihat agent yang di bawah mereka.
// Filter opsional pending (belum email_verified = belum accept invite).
func (r *Repo) ListAgentsByReseller(ctx context.Context, resellerID uuid.UUID) ([]AgentRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, email, name, created_at, email_verified_at
		  FROM users
		 WHERE role = 'agent' AND parent_reseller_id = $1
		 ORDER BY created_at DESC
	`, resellerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AgentRow{}
	for rows.Next() {
		var a AgentRow
		if err := rows.Scan(&a.ID, &a.Email, &a.Name, &a.CreatedAt, &a.EmailVerifiedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListActorIDs — reseller + semua agent-nya. Dipakai untuk aggregate query
// (mis. hitung total domain yang di-purchase reseller + tim-nya) supaya
// query di domain_purchases cukup 1 kali dengan `purchased_by = ANY($ids)`.
//
// Kalau caller adalah agent, dia panggil ini dengan parent_reseller_id-nya
// supaya konsisten (agent lihat pool yang sama dengan reseller induk).
func (r *Repo) ListActorIDs(ctx context.Context, resellerID uuid.UUID) ([]uuid.UUID, error) {
	out := []uuid.UUID{resellerID}
	rows, err := r.pool.Query(ctx,
		`SELECT id FROM users WHERE role = 'agent' AND parent_reseller_id = $1`,
		resellerID,
	)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return out, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListClientsForReseller — semua client yang di-manage reseller ATAU
// agent-agent di bawahnya (superset dari ListClientsByManager). Dipakai
// admin detail page untuk lihat full portfolio klien 1 reseller.
func (r *Repo) ListClientsForReseller(ctx context.Context, resellerID uuid.UUID) ([]ClientRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT ca.id, ca.manager_id, ca.client_id, ca.manager_role, ca.access_status,
		       ca.created_at, ca.handed_off_at, ca.revoked_at,
		       u.email, u.name, u.created_at, u.email_verified_at IS NOT NULL,
		       `+auth.HasLoginExpr("u")+`,
		       COALESCE(dc.cnt, 0) AS domain_count
		  FROM client_assignments ca
		  JOIN users u ON u.id = ca.client_id
		  LEFT JOIN users mgr ON mgr.id = ca.manager_id
		  LEFT JOIN (
		       SELECT user_id, COUNT(*) AS cnt
		         FROM domain_purchases
		        WHERE status = 'active' AND kind = 'register'
		        GROUP BY user_id
		  ) dc ON dc.user_id = ca.client_id
		 WHERE ca.access_status != 'revoked'
		   AND (ca.manager_id = $1 OR mgr.parent_reseller_id = $1)
		 ORDER BY ca.created_at DESC
	`, resellerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClientRow{}
	for rows.Next() {
		var r ClientRow
		if err := rows.Scan(
			&r.Assignment.ID, &r.Assignment.ManagerID, &r.Assignment.ClientID,
			&r.Assignment.ManagerRole, &r.Assignment.AccessStatus,
			&r.Assignment.CreatedAt, &r.Assignment.HandedOffAt, &r.Assignment.RevokedAt,
			&r.Email, &r.Name, &r.CreatedAt, &r.EmailVerified, &r.HasLogin, &r.DomainCount,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CountClientsForReseller — pool count: klien direct reseller + klien yang
// di-invite agent-agentnya. Dipakai admin panel reseller detail supaya
// admin lihat total business (reseller + tim). Reseller/agent dashboard
// pakai CountClientsByManager (direct-only) supaya tile == list count.
func (r *Repo) CountClientsForReseller(ctx context.Context, resellerID uuid.UUID) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT ca.client_id)
		  FROM client_assignments ca
		  JOIN users mgr ON mgr.id = ca.manager_id
		 WHERE ca.access_status != 'revoked'
		   AND (ca.manager_id = $1 OR mgr.parent_reseller_id = $1)
	`, resellerID).Scan(&n)
	return n, err
}

// CountClientsByManager — hitung klien yang di-assign LANGSUNG ke caller
// (baik caller reseller atau agent). Sepadan dengan ListClientsByManager
// supaya UI stat tile match dengan list "Klien saya" — tidak dobel-count
// klien yang di-invite agent lain.
func (r *Repo) CountClientsByManager(ctx context.Context, managerID uuid.UUID) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM client_assignments
		 WHERE manager_id = $1 AND access_status != 'revoked'
	`, managerID).Scan(&n)
	return n, err
}

// CountClientsViaAgents — hitung klien yang di-invite oleh AGENT-agent
// reseller (bukan direct). Dipakai reseller dashboard untuk info tambahan
// "Klien tim: N" — cegah confusion dengan direct count.
//
// DISTINCT karena satu klien bisa di-share antar agent (walau jarang).
// Klien yang di-invite reseller sendiri di-exclude via `mgr.role = 'agent'`.
func (r *Repo) CountClientsViaAgents(ctx context.Context, resellerID uuid.UUID) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT ca.client_id)
		  FROM client_assignments ca
		  JOIN users mgr ON mgr.id = ca.manager_id
		 WHERE ca.access_status != 'revoked'
		   AND mgr.role = 'agent'
		   AND mgr.parent_reseller_id = $1
	`, resellerID).Scan(&n)
	return n, err
}

// CountAgentsForReseller — hitung agent aktif di bawah reseller (baik yang
// sudah accept invite atau masih pending).
func (r *Repo) CountAgentsForReseller(ctx context.Context, resellerID uuid.UUID) (int64, error) {
	var n int64
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE role = 'agent' AND parent_reseller_id = $1`,
		resellerID,
	).Scan(&n)
	return n, err
}

// pgErrCode helper — reuse pattern dari auth package.
func pgErrCode(err error) string {
	type pgErr interface{ SQLState() string }
	if e, ok := err.(pgErr); ok {
		return e.SQLState()
	}
	return ""
}

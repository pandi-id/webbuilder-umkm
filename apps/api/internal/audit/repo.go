// Package audit — append-only event log untuk aksi sensitif. Repo di-inject
// ke handler yang perlu record (auth reseller approve, domain purchase,
// invitation, wallet, dst.). Design fire-and-forget: Log() TIDAK propagate
// error ke request path — sekedar log warn kalau DB fail supaya tidak block
// user action karena telemetry issue.
package audit

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Event constants — enum stabil supaya query bisa filter tanpa fuzzy match.
// Naming: <domain>.<verb> (past tense). Tambah di sini dulu sebelum call site.
const (
	EventResellerApplied     = "reseller.applied"
	EventResellerApproved    = "reseller.approved"
	EventResellerSuspended   = "reseller.suspended"
	EventAgentInvited        = "agent.invited"
	EventClientInvited       = "client.invited"
	EventClientReinvited     = "client.reinvited"
	EventClientUnlinked      = "client.unlinked"
	EventInvitationAccepted  = "invitation.accepted"
	EventDomainPurchased     = "purchase.created"      // own-purchase
	EventDomainPurchasedOBO  = "purchase.on_behalf_of" // reseller/agent for client
	EventDomainRetried       = "purchase.retried"
	EventDomainRenewed       = "purchase.renewed"
	EventPromoApplied        = "promo.applied"
	EventWalletTopupInit     = "wallet.topup_initiated"
	EventWalletProofUploaded = "wallet.proof_uploaded"
	EventSiteMemberAdded     = "site_member.added"
	EventSiteMemberRemoved   = "site_member.removed"
	EventSiteMemberLeft      = "site_member.left"
	EventAdminUserPromoted   = "admin.user_promoted"
	EventAdminUserDemoted    = "admin.user_demoted"
	EventAdminUserDeleted    = "admin.user_deleted"
	EventAdminUserUpdated    = "admin.user_updated"
	EventAdminSiteDeleted    = "admin.site_deleted"
)

// Entry = 1 row audit_log — mirror shape SQL. IP + UserAgent optional.
type Entry struct {
	ID         uuid.UUID       `json:"id"`
	ActorID    *uuid.UUID      `json:"actor_id,omitempty"`
	Event      string          `json:"event"`
	TargetType string          `json:"target_type,omitempty"`
	TargetID   string          `json:"target_id,omitempty"`
	Metadata   json.RawMessage `json:"metadata"`
	IP         string          `json:"ip,omitempty"`
	UserAgent  string          `json:"user_agent,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

// Params — input untuk Log(). Semua field opsional kecuali Event. Metadata
// nil aman → serialize sebagai `{}`. ActorID nil = system-initiated event.
type Params struct {
	ActorID    *uuid.UUID
	Event      string
	TargetType string
	TargetID   string
	Metadata   map[string]any
	IP         string
	UserAgent  string
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

// Log — write 1 audit row. Fire-and-forget di caller (spawn goroutine kalau
// mau non-blocking). Method sync sengaja supaya caller punya kontrol timing
// (mis. saat testing pengen tunggu row jadi persisted).
//
// Fail behavior: return error ke caller, tapi caller SHOULD log warn saja +
// lanjut request handling — audit failure bukan business-critical.
func (r *Repo) Log(ctx context.Context, p Params) error {
	if p.Event == "" {
		return nil
	}
	meta := []byte(`{}`)
	if len(p.Metadata) > 0 {
		if b, err := json.Marshal(p.Metadata); err == nil {
			meta = b
		}
	}
	var targetType, targetID *string
	if p.TargetType != "" {
		t := p.TargetType
		targetType = &t
	}
	if p.TargetID != "" {
		t := p.TargetID
		targetID = &t
	}
	var ip, ua *string
	if p.IP != "" {
		i := p.IP
		ip = &i
	}
	if p.UserAgent != "" {
		u := p.UserAgent
		ua = &u
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO audit_log (actor_id, event, target_type, target_id, metadata, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6::inet, $7)
	`, p.ActorID, p.Event, targetType, targetID, meta, ip, ua)
	if err != nil {
		slog.Warn("audit: log failed", "event", p.Event, "error", err)
	}
	return err
}

// ListFilter — query untuk halaman admin viewer. Semua field opsional; kalau
// kosong berarti "no filter di dimensi itu".
type ListFilter struct {
	Event      string // exact match
	ActorID    *uuid.UUID
	TargetType string
	TargetID   string
	Since      *time.Time
	Until      *time.Time
	Limit      int
	Offset     int
}

// ListWithActor = Entry + join users untuk display email + name di UI.
type ListWithActor struct {
	Entry
	ActorEmail string `json:"actor_email,omitempty"`
	ActorName  string `json:"actor_name,omitempty"`
}

// List — admin paginated audit trail. Order DESC by created_at (terbaru dulu).
func (r *Repo) List(ctx context.Context, f ListFilter) ([]ListWithActor, int, error) {
	args := []any{}
	where := []string{"1=1"}
	i := 1
	add := func(clause string, val any) {
		where = append(where, clause+" $"+itoa(i))
		args = append(args, val)
		i++
	}
	if f.Event != "" {
		add("al.event =", f.Event)
	}
	if f.ActorID != nil {
		add("al.actor_id =", *f.ActorID)
	}
	if f.TargetType != "" {
		add("al.target_type =", f.TargetType)
	}
	if f.TargetID != "" {
		add("al.target_id =", f.TargetID)
	}
	if f.Since != nil {
		add("al.created_at >=", *f.Since)
	}
	if f.Until != nil {
		add("al.created_at <=", *f.Until)
	}
	whereSQL := ""
	for j, w := range where {
		if j == 0 {
			whereSQL = w
		} else {
			whereSQL += " AND " + w
		}
	}

	// Count first — untuk pagination total.
	var total int
	countSQL := `SELECT COUNT(*) FROM audit_log al WHERE ` + whereSQL
	if err := r.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Data query.
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	dataArgs := append(append([]any{}, args...), limit, f.Offset)
	rows, err := r.pool.Query(ctx, `
		SELECT al.id, al.actor_id, al.event, al.target_type, al.target_id,
		       al.metadata, host(al.ip)::text, al.user_agent, al.created_at,
		       COALESCE(u.email, ''), COALESCE(u.name, '')
		  FROM audit_log al
		  LEFT JOIN users u ON u.id = al.actor_id
		 WHERE `+whereSQL+`
		 ORDER BY al.created_at DESC
		 LIMIT $`+itoa(i)+` OFFSET $`+itoa(i+1), dataArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []ListWithActor{}
	for rows.Next() {
		var a ListWithActor
		var targetType, targetID, ip, ua *string
		if err := rows.Scan(
			&a.ID, &a.ActorID, &a.Event, &targetType, &targetID,
			&a.Metadata, &ip, &ua, &a.CreatedAt,
			&a.ActorEmail, &a.ActorName,
		); err != nil {
			return nil, 0, err
		}
		if targetType != nil {
			a.TargetType = *targetType
		}
		if targetID != nil {
			a.TargetID = *targetID
		}
		if ip != nil {
			a.IP = *ip
		}
		if ua != nil {
			a.UserAgent = *ua
		}
		out = append(out, a)
	}
	return out, total, rows.Err()
}

// PgxRowScanner — sanity to avoid unused import complaint (kept for future).
var _ = pgx.ErrNoRows

// itoa — small positional-arg helper. Batas 999 args cukup untuk WHERE builder.
func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	if n < 100 {
		return string(rune('0'+n/10)) + string(rune('0'+n%10))
	}
	return string(rune('0'+n/100)) + string(rune('0'+(n/10)%10)) + string(rune('0'+n%10))
}

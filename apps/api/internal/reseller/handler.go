package reseller

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/webbuilder/api/internal/audit"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/mail"
)

// StatsProvider — dep untuk aggregate stats endpoint (Phase 6). Interface,
// bukan concrete import ke domain_purchase, supaya reseller package tetap
// lean + testable.
type StatsProvider interface {
	GetResellerStats(ctx context.Context, actorIDs []uuid.UUID) (*DomainStats, error)
	// ListByPurchaser — purchases yang di-trigger oleh purchaserID. Dipakai
	// agent detail page untuk render list domain yang agent daftarkan.
	ListByPurchaser(ctx context.Context, purchaserID uuid.UUID, limit int) ([]PurchaseSummary, error)
}

// DomainStats — mirror struct domain_purchase.ResellerStats supaya interface
// tidak leak concrete type dari package tetangga.
type DomainStats struct {
	ActiveDomains  int64
	Expiring30Days int64
	Expiring90Days int64
	PendingJobs    int64
}

// PurchaseSummary — subset field yang dipakai UI reseller. Sengaja tidak
// mirror penuh Purchase struct dari domain_purchase supaya interface stabil
// walau field internal di package sana berubah.
type PurchaseSummary struct {
	JobID      string     `json:"job_id"`
	Domain     string     `json:"domain"`
	Status     string     `json:"status"`
	Kind       string     `json:"kind"`
	Years      int        `json:"years"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UserID     uuid.UUID  `json:"user_id"` // owner (client kalau on-behalf-of)
	PaymentURL string     `json:"payment_url,omitempty"`
}

// Handler bundles repo + auth repo + mailer supaya endpoint reseller portal
// bisa akses user + invitation table plus kirim email.
// ContactSyncer — hook opsional untuk propagate update profil client ke
// registrar contact di seluruh domain aktif. Interface lokal supaya reseller
// package tidak import contactsync (menghindari import cycle).
type ContactSyncer interface {
	SyncUser(userID uuid.UUID)
}

type Handler struct {
	repo       *Repo
	authRepo   *auth.Repo
	mailer     mail.Sender
	appBaseURL string // dipakai bangun URL invite
	stats      StatsProvider // nil = stats endpoint 503
	audit      *audit.Repo   // nil = audit disabled (silent)

	contactSyncer ContactSyncer // nil = no propagation
}

func NewHandler(r *Repo, authRepo *auth.Repo, mailer mail.Sender, appBaseURL string) *Handler {
	return &Handler{
		repo:       r,
		authRepo:   authRepo,
		mailer:     mailer,
		appBaseURL: strings.TrimRight(appBaseURL, "/"),
	}
}

// SetStatsProvider — wire domain_purchase repo pasca-construction, hindari
// import cycle (main.go injects setelah kedua handler dibuat).
func (h *Handler) SetStatsProvider(p StatsProvider) { h.stats = p }

// SetAudit inject audit repo untuk record invite/create events (Phase 7).
// Nil = no-op.
func (h *Handler) SetAudit(r *audit.Repo) { h.audit = r }

// SetContactSyncer inject syncer pasca-construction. Nil-safe.
func (h *Handler) SetContactSyncer(s ContactSyncer) { h.contactSyncer = s }

// logAudit — fire-and-forget helper, safe kalau audit nil.
func (h *Handler) logAudit(ctx context.Context, actor uuid.UUID, event, targetType, targetID string, meta map[string]any) {
	if h.audit == nil {
		return
	}
	var actorID *uuid.UUID
	if actor != uuid.Nil {
		actorID = &actor
	}
	_ = h.audit.Log(ctx, audit.Params{
		ActorID:    actorID,
		Event:      event,
		TargetType: targetType,
		TargetID:   targetID,
		Metadata:   meta,
	})
}

// resellerContext — helper extract caller yang valid reseller aktif atau
// agent aktif. Return error kalau bukan.
type callerCtx struct {
	User             *auth.User
	IsReseller       bool
	IsAgent          bool
	EffectiveReseller uuid.UUID // untuk agent, ini parent_reseller_id; untuk reseller, ini self ID
}

func (h *Handler) resolveCaller(c *fiber.Ctx) (*callerCtx, error) {
	uid := auth.UserIDFrom(c)
	if uid == uuid.Nil {
		return nil, errors.New("unauthenticated")
	}
	u, err := h.authRepo.GetByID(c.Context(), uid)
	if err != nil {
		return nil, err
	}
	ctx := &callerCtx{User: u}
	switch u.Role {
	case auth.RoleReseller:
		if u.ResellerStatus != auth.ResellerStatusActive {
			return nil, errors.New("reseller belum aktif")
		}
		ctx.IsReseller = true
		ctx.EffectiveReseller = u.ID
	case auth.RoleAgent:
		if u.ParentResellerID == nil {
			return nil, errors.New("agent tidak punya reseller induk")
		}
		ctx.IsAgent = true
		ctx.EffectiveReseller = *u.ParentResellerID
	default:
		return nil, errors.New("role tidak diizinkan")
	}
	return ctx, nil
}

// ---------------- Invite Agent ----------------
//
// Reseller kirim invite email → agent klik link → /invite/<token>
// → set password → agent user baru terbentuk (role='agent',
// parent_reseller_id=reseller).

type inviteAgentReq struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

// InviteAgent — POST /api/v1/reseller/agents/invite (reseller only).
// agentInviteBlocker returns why `u` cannot be invited as this reseller's
// agent, or "" when they can. Only plain clients are eligible: promoting a
// reseller or admin would be a demotion, and an agent already belongs to
// someone. Messages are user-facing (shown in the invite dialog).
func agentInviteBlocker(u *auth.User, resellerID uuid.UUID) string {
	switch u.Role {
	case auth.RoleClient:
		return ""
	case auth.RoleAgent:
		if u.ParentResellerID != nil && *u.ParentResellerID == resellerID {
			return "user ini sudah menjadi agent Anda"
		}
		return "user ini sudah menjadi agent reseller lain"
	case auth.RoleReseller:
		return "user ini seorang reseller, tidak bisa dijadikan agent"
	case auth.RoleAdmin:
		return "user ini administrator, tidak bisa dijadikan agent"
	default:
		return "role user ini tidak bisa dijadikan agent"
	}
}

func (h *Handler) InviteAgent(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	if !caller.IsReseller {
		return httpx.Forbidden(c, "hanya reseller yang boleh invite agent")
	}
	var req inviteAgentReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	if !strings.Contains(req.Email, "@") {
		return httpx.BadRequest(c, "email tidak valid")
	}
	// An existing account can be promoted to agent — that is the common case,
	// since agents usually start out as ordinary users. Attaching them to a
	// target_user_id keeps the sites and domains they already own.
	existing, _ := h.authRepo.GetByEmail(c.Context(), req.Email)
	var targetUserID *uuid.UUID
	if existing != nil {
		if reason := agentInviteBlocker(existing, caller.User.ID); reason != "" {
			return httpx.Conflict(c, reason)
		}
		if assigned, _ := h.repo.FindActiveAssignmentByClient(c.Context(), existing.ID); assigned != nil &&
			assigned.ManagerID != caller.User.ID {
			return httpx.Conflict(c, "user ini sedang dikelola manager lain")
		}
		targetUserID = &existing.ID
	}

	raw, _, err := h.authRepo.CreateInvitation(
		c.Context(), req.Email, auth.RoleAgent, caller.User.ID, targetUserID, 7*24*time.Hour,
	)
	if err != nil {
		return httpx.Internal(c, "create invitation failed")
	}

	// Fire-and-forget email
	go h.sendInviteEmail(caller.User, req.Email, req.Name, auth.RoleAgent, raw)

	h.logAudit(c.Context(), caller.User.ID, audit.EventAgentInvited, "email", req.Email, map[string]any{
		"invited_name": req.Name,
	})
	return httpx.Created(c, fiber.Map{
		"email":       req.Email,
		"invite_sent": true,
		"expires_in":  "7 hari",
	})
}

// LookupAgentCandidate — GET /api/v1/reseller/agents/lookup?email= (reseller).
//
// Answers one question about one address the caller already typed in full:
// can this person become my agent? Exact-match only and never a listing, so a
// reseller cannot walk the platform's user base with it. The name is returned
// so the dialog can confirm the right person before an email goes out.
func (h *Handler) LookupAgentCandidate(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	if !caller.IsReseller {
		return httpx.Forbidden(c, "hanya reseller yang boleh invite agent")
	}
	email := strings.ToLower(strings.TrimSpace(c.Query("email")))
	if !strings.Contains(email, "@") {
		return httpx.BadRequest(c, "email tidak valid")
	}

	existing, _ := h.authRepo.GetByEmail(c.Context(), email)
	if existing == nil {
		// Not a user yet — the invite will create a fresh agent account.
		return httpx.OK(c, fiber.Map{"found": false, "eligible": true})
	}

	reason := agentInviteBlocker(existing, caller.User.ID)
	if reason == "" {
		if assigned, _ := h.repo.FindActiveAssignmentByClient(c.Context(), existing.ID); assigned != nil &&
			assigned.ManagerID != caller.User.ID {
			reason = "user ini sedang dikelola manager lain"
		}
	}
	return httpx.OK(c, fiber.Map{
		"found":    true,
		"name":     existing.Name,
		"eligible": reason == "",
		"reason":   reason,
	})
}

// ---------------- List Agents ----------------

// ListAgents — GET /api/v1/reseller/agents (reseller only).
func (h *Handler) ListAgents(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	if !caller.IsReseller {
		return httpx.Forbidden(c, "hanya reseller")
	}
	agents, err := h.repo.ListAgentsByReseller(c.Context(), caller.User.ID)
	if err != nil {
		return httpx.Internal(c, "list agents failed")
	}
	// Pending invitations (belum accept — belum ada user row).
	pending, _ := h.authRepo.ListPendingInvitationsByInviter(c.Context(), caller.User.ID, auth.RoleAgent)

	type agentResp struct {
		ID              string  `json:"id,omitempty"` // kosong kalau pending invite
		Email           string  `json:"email"`
		Name            string  `json:"name,omitempty"`
		Status          string  `json:"status"` // 'active' | 'pending_invite'
		CreatedAt       string  `json:"created_at"`
		EmailVerifiedAt *string `json:"email_verified_at,omitempty"`
	}
	out := make([]agentResp, 0, len(agents)+len(pending))
	for _, a := range agents {
		r := agentResp{
			ID:        a.ID.String(),
			Email:     a.Email,
			Name:      a.Name,
			Status:    "active",
			CreatedAt: a.CreatedAt.Format(time.RFC3339),
		}
		if a.EmailVerifiedAt != nil {
			s := a.EmailVerifiedAt.Format(time.RFC3339)
			r.EmailVerifiedAt = &s
		}
		out = append(out, r)
	}
	for _, inv := range pending {
		out = append(out, agentResp{
			Email:     inv.Email,
			Status:    "pending_invite",
			CreatedAt: inv.CreatedAt.Format(time.RFC3339),
		})
	}
	return httpx.OK(c, out)
}

// ---------------- Agent Detail (reseller only) ----------------

// resolveOwnedAgent — helper: parse :agent_id param + verify agent milik
// caller (parent_reseller_id = caller.ID). Return agent user + counts info
// via authRepo/repo. 404 kalau bukan agent atau bukan milik caller.
func (h *Handler) resolveOwnedAgent(c *fiber.Ctx) (*auth.User, error) {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return nil, httpx.Forbidden(c, err.Error())
	}
	if !caller.IsReseller {
		return nil, httpx.Forbidden(c, "hanya reseller yang boleh akses detail agent")
	}
	agentID, err := uuid.Parse(c.Params("agent_id"))
	if err != nil {
		return nil, httpx.BadRequest(c, "agent_id bukan UUID valid")
	}
	agent, err := h.authRepo.GetByID(c.Context(), agentID)
	if err != nil {
		return nil, httpx.NotFound(c, "agent tidak ditemukan")
	}
	// Guard: agent WAJIB role=agent + parent_reseller_id = caller.
	if agent.Role != auth.RoleAgent {
		return nil, httpx.NotFound(c, "user bukan agent")
	}
	if agent.ParentResellerID == nil || *agent.ParentResellerID != caller.User.ID {
		return nil, httpx.NotFound(c, "agent bukan bawahan Anda")
	}
	return agent, nil
}

// GetAgent — GET /api/v1/reseller/agents/:agent_id
//
// Detail agent + counts ringkas (jumlah klien di-manage + agregat domain).
// Reseller-only, ownership check via parent_reseller_id.
func (h *Handler) GetAgent(c *fiber.Ctx) error {
	agent, ferr := h.resolveOwnedAgent(c)
	if ferr != nil {
		return ferr
	}
	// Counts — best-effort, kalau salah satu fail balikin partial supaya UI
	// bisa tampilkan identitas dulu.
	clientCount, _ := h.repo.CountClientsByManager(c.Context(), agent.ID)

	var stats *DomainStats
	if h.stats != nil {
		stats, _ = h.stats.GetResellerStats(c.Context(), []uuid.UUID{agent.ID})
	}
	if stats == nil {
		stats = &DomainStats{}
	}

	resp := fiber.Map{
		"id":                agent.ID.String(),
		"email":             agent.Email,
		"name":              agent.Name,
		"phone_number":      agent.PhoneNumber,
		"created_at":        agent.CreatedAt.Format(time.RFC3339),
		"email_verified":    agent.EmailVerifiedAt != nil,
		"clients":           clientCount,
		"active_domains":    stats.ActiveDomains,
		"pending_jobs":      stats.PendingJobs,
		"expiring_30_days":  stats.Expiring30Days,
		"expiring_90_days":  stats.Expiring90Days,
	}
	if agent.EmailVerifiedAt != nil {
		resp["email_verified_at"] = agent.EmailVerifiedAt.Format(time.RFC3339)
	}
	return httpx.OK(c, resp)
}

// ListAgentClients — GET /api/v1/reseller/agents/:agent_id/clients
// Reseller lihat klien yang di-manage agent-nya (delegasi visibility).
func (h *Handler) ListAgentClients(c *fiber.Ctx) error {
	agent, ferr := h.resolveOwnedAgent(c)
	if ferr != nil {
		return ferr
	}
	items, err := h.repo.ListClientsByManager(c.Context(), agent.ID)
	if err != nil {
		return httpx.Internal(c, "list clients failed")
	}
	type clientResp struct {
		ClientID      string `json:"client_id"`
		AssignmentID  string `json:"assignment_id"`
		Email         string `json:"email"`
		Name          string `json:"name"`
		AccessStatus  string `json:"access_status"`
		EmailVerified bool   `json:"email_verified"`
		CreatedAt     string `json:"created_at"`
		DomainCount   int    `json:"domain_count"`
	}
	out := make([]clientResp, 0, len(items))
	for _, r := range items {
		out = append(out, clientResp{
			ClientID:      r.Assignment.ClientID.String(),
			AssignmentID:  r.Assignment.ID.String(),
			Email:         r.Email,
			Name:          r.Name,
			AccessStatus:  r.Assignment.AccessStatus,
			EmailVerified: r.EmailVerified,
			CreatedAt:     r.CreatedAt.Format(time.RFC3339),
			DomainCount:   r.DomainCount,
		})
	}
	return httpx.OK(c, out)
}

// ListAgentPurchases — GET /api/v1/reseller/agents/:agent_id/purchases
// Reseller lihat domain yang agent daftarkan (purchased_by = agent).
func (h *Handler) ListAgentPurchases(c *fiber.Ctx) error {
	agent, ferr := h.resolveOwnedAgent(c)
	if ferr != nil {
		return ferr
	}
	if h.stats == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "purchases_disabled",
			"Domain purchase module belum wired.")
	}
	items, err := h.stats.ListByPurchaser(c.Context(), agent.ID, 500)
	if err != nil {
		return httpx.Internal(c, "list purchases failed")
	}
	return httpx.OK(c, items)
}

// ---------------- Create Client ----------------
//
// Phase 2 scope: reseller/agent bikin user client baru + assignment.
// Tidak trigger domain purchase (Phase 3 nanti). Client dapat email invite
// untuk set password + login.

type createClientReq struct {
	Email       string `json:"email"`
	Name        string `json:"name"`
	PhoneNumber string `json:"phone_number,omitempty"`
	Address     string `json:"address,omitempty"`
	City        string `json:"city,omitempty"`
	State       string `json:"state,omitempty"`
	PostalCode  string `json:"postal_code,omitempty"`
	Nik         string `json:"nik,omitempty"`
}

// profileUpdateFrom maps the filled-in fields of a create request onto a
// partial profile update. Empty strings become nil so UpdateProfile's COALESCE
// keeps whatever the client already had. Returns false when nothing was typed.
func profileUpdateFrom(req createClientReq) (auth.ProfileUpdate, bool) {
	set := func(v string) *string {
		v = strings.TrimSpace(v)
		if v == "" {
			return nil
		}
		return &v
	}
	upd := auth.ProfileUpdate{
		Name:        set(req.Name),
		PhoneNumber: set(req.PhoneNumber),
		Address:     set(req.Address),
		City:        set(req.City),
		State:       set(req.State),
		PostalCode:  set(req.PostalCode),
		Nik:         set(req.Nik),
	}
	any := upd.Name != nil || upd.PhoneNumber != nil || upd.Address != nil ||
		upd.City != nil || upd.State != nil || upd.PostalCode != nil || upd.Nik != nil
	return upd, any
}

// CreateClient — POST /api/v1/reseller/clients (reseller atau agent).
//
// Untuk agent: manager_id=agent, assignment ke agent. Reseller induk
// tidak otomatis dapat assignment (kalau reseller mau see, harus lookup
// agents-nya). MVP: reseller aja yang boleh direct-invite, agent nanti
// Phase 2.5.
//
// Actually per plan section 3 permission matrix, agent boleh create client
// baru (asigned to self). Jadi endpoint dukung both.
func (h *Handler) CreateClient(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	var req createClientReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	if !strings.Contains(req.Email, "@") {
		return httpx.BadRequest(c, "email tidak valid")
	}
	if req.Name == "" {
		return httpx.BadRequest(c, "nama wajib diisi")
	}

	// Cek email exists.
	existing, _ := h.authRepo.GetByEmail(c.Context(), req.Email)
	var clientID uuid.UUID
	profileUpdated := false
	if existing != nil {
		// Existing user — kalau bukan client, reject.
		if existing.Role != auth.RoleClient {
			return httpx.Conflict(c, "email sudah terdaftar sebagai "+existing.Role+", tidak bisa jadi client")
		}
		// Kalau existing client sudah di-manage reseller LAIN, reject.
		otherAssign, _ := h.repo.FindActiveAssignmentByClient(c.Context(), existing.ID)
		if otherAssign != nil && otherAssign.ManagerID != caller.User.ID {
			return httpx.Conflict(c, "email sudah dikelola oleh manager lain")
		}
		clientID = existing.ID

		// Apply what the caller typed to the existing account. Only non-empty
		// fields are sent: an untouched box must not wipe data the client
		// entered themselves, but a filled one is a deliberate correction and
		// used to be discarded silently.
		if upd, any := profileUpdateFrom(req); any {
			if _, err := h.authRepo.UpdateProfile(c.Context(), clientID, upd); err != nil {
				slog.Warn("reseller: update existing client profile failed",
					"client_id", clientID, "err", err)
			} else {
				profileUpdated = true
			}
		}
	} else {
		// Bikin user baru (password kosong, email tidak verified, tunggu invite).
		u, err := h.authRepo.CreateClientPlaceholder(c.Context(), auth.ClientPlaceholder{
			Email:       req.Email,
			Name:        req.Name,
			PhoneNumber: req.PhoneNumber,
			Address:     req.Address,
			City:        req.City,
			State:       req.State,
			PostalCode:  req.PostalCode,
			Nik:         req.Nik,
		})
		if err != nil {
			if errors.Is(err, auth.ErrEmailTaken) {
				return httpx.Conflict(c, "email sudah terdaftar")
			}
			return httpx.Internal(c, "create client failed")
		}
		clientID = u.ID
	}

	// Create assignment.
	assignment, err := h.repo.CreateAssignment(c.Context(), caller.User.ID, clientID, caller.User.Role)
	if err != nil {
		if errors.Is(err, ErrAlreadyAssigned) {
			return httpx.Conflict(c, "client ini sudah di-assign ke Anda")
		}
		return httpx.Internal(c, "create assignment failed")
	}

	// A brand-new account needs an invite to set a password. An existing user
	// already has one, so they get a heads-up instead — being attached to a
	// manager means that manager can now see and act on their sites, and they
	// should not find that out by accident.
	emailed := false
	if existing == nil {
		raw, _, invErr := h.authRepo.CreateInvitation(
			c.Context(), req.Email, auth.RoleClient, caller.User.ID, &clientID, 7*24*time.Hour,
		)
		if invErr == nil {
			emailed = true
			go h.sendInviteEmail(caller.User, req.Email, req.Name, auth.RoleClient, raw)
		} else {
			slog.Warn("reseller: create client invitation failed", "err", invErr)
		}
	} else {
		name := existing.Name
		if name == "" {
			name = req.Name
		}
		emailed = h.mailer != nil
		go h.sendClientLinkedEmail(caller.User, req.Email, name)
	}

	h.logAudit(c.Context(), caller.User.ID, audit.EventClientInvited, "user", clientID.String(), map[string]any{
		"email":       req.Email,
		"name":        req.Name,
		"is_new_user": existing == nil,
	})
	return httpx.Created(c, fiber.Map{
		"client_id":     clientID.String(),
		"assignment_id": assignment.ID.String(),
		"is_new_user":   existing == nil,
		// invite_sent stays "we sent a set-password link"; email_sent covers
		// either mail, so the UI can report what actually happened.
		"invite_sent": existing == nil,
		"email_sent":  emailed,
		// True when an existing account's profile was changed by this call.
		"profile_updated": profileUpdated,
	})
}

// ---------------- List Clients ----------------

// ListClients — GET /api/v1/reseller/clients ATAU /api/v1/agent/clients.
//   - reseller → direct clients + clients dari agent-agent nya (team scope)
//   - agent    → direct clients saja
func (h *Handler) ListClients(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	var items []ClientRow
	if caller.User.Role == auth.RoleReseller {
		items, err = h.repo.ListClientsForReseller(c.Context(), caller.User.ID)
	} else {
		items, err = h.repo.ListClientsByManager(c.Context(), caller.User.ID)
	}
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	type clientResp struct {
		ClientID      string `json:"client_id"`
		AssignmentID  string `json:"assignment_id"`
		Email         string `json:"email"`
		Name          string `json:"name"`
		AccessStatus  string `json:"access_status"`
		EmailVerified bool   `json:"email_verified"`
		CreatedAt     string `json:"created_at"`
		DomainCount   int    `json:"domain_count"`
	}
	out := make([]clientResp, 0, len(items))
	for _, r := range items {
		out = append(out, clientResp{
			ClientID:      r.Assignment.ClientID.String(),
			AssignmentID:  r.Assignment.ID.String(),
			Email:         r.Email,
			Name:          r.Name,
			AccessStatus:  r.Assignment.AccessStatus,
			EmailVerified: r.EmailVerified,
			CreatedAt:     r.CreatedAt.Format(time.RFC3339),
			DomainCount:   r.DomainCount,
		})
	}
	return httpx.OK(c, out)
}

// ---------------- Get Client Profile ----------------

// GetClient — GET /api/v1/reseller/clients/:client_id ATAU /api/v1/agent/clients/:client_id.
// Return profil client (subset field yang dibutuhkan wizard: nama, email,
// alamat, HP, kota, kode pos, NIK). Ownership check via assignment lookup —
// caller HARUS punya active assignment ke client_id. Cegah URL guessing.
func (h *Handler) GetClient(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	clientID, err := uuid.Parse(c.Params("client_id"))
	if err != nil {
		return httpx.BadRequest(c, "client_id bukan UUID valid")
	}
	if _, err := h.repo.FindActiveAssignmentBetween(c.Context(), caller.User.ID, clientID); err != nil {
		return httpx.NotFound(c, "klien tidak ditemukan atau bukan asuhan Anda")
	}
	u, err := h.authRepo.GetByID(c.Context(), clientID)
	if err != nil {
		return httpx.Internal(c, "lookup failed")
	}
	return httpx.OK(c, fiber.Map{
		"id":           u.ID.String(),
		"email":        u.Email,
		"name":         u.Name,
		"phone_number": u.PhoneNumber,
		"address":      u.Address,
		"city":         u.City,
		"state":        u.State,
		"postal_code":  u.PostalCode,
		"nik":          u.Nik,
		"role":         u.Role,
	})
}

// ---------------- Update Client Profile ----------------

// updateClientReq — semua field optional (pointer) supaya kita bisa update
// per-field tanpa wipe kolom lain. NIK dipisah karena inilah use-case
// utamanya (client belum isi NIK, agent isi dari wizard on-behalf-of biar
// bisa lanjut register domain .id).
type updateClientReq struct {
	Name        *string `json:"name,omitempty"`
	PhoneNumber *string `json:"phone_number,omitempty"`
	Address     *string `json:"address,omitempty"`
	City        *string `json:"city,omitempty"`
	State       *string `json:"state,omitempty"`
	PostalCode  *string `json:"postal_code,omitempty"`
	Nik         *string `json:"nik,omitempty"`
}

// UpdateClient — PATCH /api/v1/reseller/clients/:client_id
// Reseller ATAU agent boleh update profil client yang mereka manage. Ownership
// via active assignment (sama seperti GetClient). Digunakan oleh wizard
// on-behalf-of untuk isi NIK klien tanpa harus minta klien login sendiri.
//
// COALESCE-based UPDATE — nil pointer = tidak ubah field itu.
// UnlinkClient — DELETE /api/v1/{reseller,agent}/clients/:client_id.
//
// Removes the assignment, NOT the user. Clients own their own sites and
// domains, and many signed up themselves before a manager ever added them —
// deleting the account from here would destroy data that is not the caller's.
// The row simply leaves the manager's list (`access_status != 'revoked'`).
func (h *Handler) UnlinkClient(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	clientID, err := uuid.Parse(c.Params("client_id"))
	if err != nil {
		return httpx.BadRequest(c, "client_id bukan UUID valid")
	}
	if err := h.repo.RevokeAssignment(c.Context(), caller.User.ID, clientID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "klien tidak ditemukan atau bukan asuhan Anda")
		}
		return httpx.Internal(c, "unlink client failed")
	}
	h.logAudit(c.Context(), caller.User.ID, audit.EventClientUnlinked, "user", clientID.String(), nil)
	return httpx.OK(c, fiber.Map{"unlinked": true})
}

// ResendClientInvite — POST /api/v1/{reseller,agent}/clients/:client_id/resend-invite.
//
// Only for an account that still cannot log in. Once the client has a password
// (or a Google link) there is no invitation to accept, and reissuing one would
// hand the manager a link that sets someone else's password.
func (h *Handler) ResendClientInvite(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	clientID, err := uuid.Parse(c.Params("client_id"))
	if err != nil {
		return httpx.BadRequest(c, "client_id bukan UUID valid")
	}
	if _, err := h.repo.FindActiveAssignmentBetween(c.Context(), caller.User.ID, clientID); err != nil {
		return httpx.NotFound(c, "klien tidak ditemukan atau bukan asuhan Anda")
	}
	client, err := h.authRepo.GetByID(c.Context(), clientID)
	if err != nil {
		return httpx.NotFound(c, "klien tidak ditemukan")
	}
	hasLogin, err := h.authRepo.HasLogin(c.Context(), client.ID)
	if err != nil {
		return httpx.Internal(c, "cek akses login klien gagal")
	}
	if hasLogin {
		return httpx.Conflict(c, "klien sudah punya akses login, undangan tidak perlu dikirim ulang")
	}
	if h.mailer == nil {
		return httpx.Internal(c, "pengiriman email belum dikonfigurasi")
	}

	raw, _, err := h.authRepo.CreateInvitation(
		c.Context(), client.Email, auth.RoleClient, caller.User.ID, &clientID, 7*24*time.Hour,
	)
	if err != nil {
		return httpx.Internal(c, "gagal membuat undangan baru")
	}
	name := client.Name
	if name == "" {
		name = client.Email
	}
	go h.sendInviteEmail(caller.User, client.Email, name, auth.RoleClient, raw)

	h.logAudit(c.Context(), caller.User.ID, audit.EventClientReinvited, "user", clientID.String(), map[string]any{
		"email": client.Email,
	})
	return httpx.OK(c, fiber.Map{"invite_sent": true, "email": client.Email})
}

func (h *Handler) UpdateClient(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	clientID, err := uuid.Parse(c.Params("client_id"))
	if err != nil {
		return httpx.BadRequest(c, "client_id bukan UUID valid")
	}
	if _, err := h.repo.FindActiveAssignmentBetween(c.Context(), caller.User.ID, clientID); err != nil {
		return httpx.NotFound(c, "klien tidak ditemukan atau bukan asuhan Anda")
	}
	var req updateClientReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	// Semua field null → no-op (return current). Cegah round-trip yang tidak
	// perlu tanpa fail body kosong (frontend boleh submit form parsial).
	if req.Name == nil && req.PhoneNumber == nil && req.Address == nil &&
		req.City == nil && req.State == nil && req.PostalCode == nil && req.Nik == nil {
		return httpx.BadRequest(c, "minimal 1 field harus diisi")
	}
	// Trim string pointer supaya "  " tidak nyimpan whitespace.
	trimPtr := func(p *string) *string {
		if p == nil {
			return nil
		}
		v := strings.TrimSpace(*p)
		return &v
	}
	u, err := h.authRepo.UpdateProfile(c.Context(), clientID, auth.ProfileUpdate{
		Name:        trimPtr(req.Name),
		PhoneNumber: trimPtr(req.PhoneNumber),
		Address:     trimPtr(req.Address),
		City:        trimPtr(req.City),
		State:       trimPtr(req.State),
		PostalCode:  trimPtr(req.PostalCode),
		Nik:         trimPtr(req.Nik),
	})
	if err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			return httpx.NotFound(c, "klien tidak ditemukan")
		}
		return httpx.Internal(c, "update failed")
	}
	// Propagate ke registrar contact untuk semua domain aktif klien —
	// async fire-and-forget.
	if h.contactSyncer != nil {
		h.contactSyncer.SyncUser(u.ID)
	}
	return httpx.OK(c, fiber.Map{
		"id":           u.ID.String(),
		"email":        u.Email,
		"name":         u.Name,
		"phone_number": u.PhoneNumber,
		"address":      u.Address,
		"city":         u.City,
		"state":        u.State,
		"postal_code":  u.PostalCode,
		"nik":          u.Nik,
		"role":         u.Role,
	})
}

// ---------------- Stats (Phase 6) ----------------

// GetStats — GET /api/v1/reseller/stats
// Aggregate untuk dashboard reseller: total client + agent + domain aktif +
// expiring soon. Agent lihat stats reseller induk (pool sama).
func (h *Handler) GetStats(c *fiber.Ctx) error {
	caller, err := h.resolveCaller(c)
	if err != nil {
		return httpx.Forbidden(c, err.Error())
	}
	resellerID := caller.EffectiveReseller

	// Aggregate parallel-safe (query independen, tidak share transaction).
	// Best-effort — kalau salah satu fail, return 500 supaya UI retry.
	//
	// `clients` = klien direct caller (matches ListClientsByManager). Sebelumnya
	// pool count (via agents) — dilepas karena bikin tile != list count.
	clientCount, err := h.repo.CountClientsByManager(c.Context(), caller.User.ID)
	if err != nil {
		return httpx.Internal(c, "client count failed")
	}
	agentCount, err := h.repo.CountAgentsForReseller(c.Context(), resellerID)
	if err != nil {
		return httpx.Internal(c, "agent count failed")
	}
	// clients_via_agents cuma relevan untuk reseller — agent tidak lihat
	// klien-klien milik agent lain (per plan permission matrix).
	var clientsViaAgents int64
	if caller.User.Role == auth.RoleReseller {
		clientsViaAgents, err = h.repo.CountClientsViaAgents(c.Context(), resellerID)
		if err != nil {
			return httpx.Internal(c, "team client count failed")
		}
	}

	// Domain stats — actor IDs = reseller + agent-nya. Purchase yang di-trigger
	// oleh siapapun di tim ini dihitung.
	actorIDs, err := h.repo.ListActorIDs(c.Context(), resellerID)
	if err != nil {
		return httpx.Internal(c, "actor ids failed")
	}
	var domainStats *DomainStats
	if h.stats != nil {
		domainStats, err = h.stats.GetResellerStats(c.Context(), actorIDs)
		if err != nil {
			return httpx.Internal(c, "domain stats failed")
		}
	} else {
		domainStats = &DomainStats{}
	}

	return httpx.OK(c, fiber.Map{
		"clients":            clientCount,
		"clients_via_agents": clientsViaAgents, // 0 untuk agent
		"agents":             agentCount,
		"active_domains":     domainStats.ActiveDomains,
		"expiring_30_days":   domainStats.Expiring30Days,
		"expiring_90_days":   domainStats.Expiring90Days,
		"pending_jobs":       domainStats.PendingJobs,
	})
}

// ---------------- Email helper ----------------

// sendInviteEmail — fire-and-forget invite email. Fail-silent kalau mailer
// tidak configured atau send fail — log warn saja.
// sendClientLinkedEmail tells an existing user that a reseller or agent now
// manages their account. No link to accept: the assignment is already made,
// and the message points at support rather than pretending otherwise.
func (h *Handler) sendClientLinkedEmail(manager *auth.User, toEmail, toName string) {
	if h.mailer == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	businessName := manager.ResellerDisplayName
	if businessName == "" {
		businessName = manager.Name
	}
	subject := businessName + " kini mengelola akun Web Builder Anda"
	body := "Halo " + toName + ",\n\n" +
		businessName + " menambahkan Anda sebagai klien di platform Web Builder.\n\n" +
		"Artinya mereka dapat membantu mendaftarkan domain dan mengelola situs atas nama Anda.\n" +
		"Akun dan password Anda tidak berubah — login seperti biasa di " + h.appBaseURL + "\n\n" +
		"Kalau Anda tidak mengenal " + businessName + ", balas email ini supaya kami tinjau.\n\n" +
		"Best regards,\nTim Web Builder"
	if err := h.mailer.Send(ctx, mail.Message{To: toEmail, Subject: subject, Body: body}); err != nil {
		slog.Warn("reseller: client linked email failed", "to", toEmail, "err", err)
	}
}

func (h *Handler) sendInviteEmail(inviter *auth.User, toEmail, toName, role, rawToken string) {
	if h.mailer == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	link := h.appBaseURL + "/invite/" + rawToken
	businessName := inviter.ResellerDisplayName
	if businessName == "" {
		businessName = inviter.Name
	}
	var subject, body string
	if role == auth.RoleAgent {
		subject = "Undangan bergabung sebagai Agent di " + businessName
		body = "Halo " + toName + ",\n\n" +
			businessName + " mengundang Anda untuk bergabung sebagai agent di platform Web Builder.\n\n" +
			"Sebagai agent, Anda dapat mendaftarkan domain + membangun situs untuk klien " + businessName + ".\n\n" +
			"Klik link berikut untuk set password + aktifkan akun (berlaku 7 hari):\n\n" +
			link + "\n\n" +
			"Kalau Anda tidak mengharapkan undangan ini, abaikan email ini.\n\n" +
			"Best regards,\nTim Web Builder"
	} else {
		subject = "Akun Web Builder Anda siap"
		body = "Halo " + toName + ",\n\n" +
			businessName + " sudah menyiapkan akun Web Builder untuk Anda.\n\n" +
			"Klik link berikut untuk set password + aktifkan akun (berlaku 7 hari):\n\n" +
			link + "\n\n" +
			"Kalau Anda tidak mengharapkan undangan ini, abaikan email ini.\n\n" +
			"Best regards,\nTim Web Builder"
	}
	if err := h.mailer.Send(ctx, mail.Message{To: toEmail, Subject: subject, Body: body}); err != nil {
		slog.Warn("reseller: invite email failed", "to", toEmail, "err", err)
	}
}

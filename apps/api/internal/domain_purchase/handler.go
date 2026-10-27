package domain_purchase

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/webbuilder/api/internal/audit"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/cloudflare"
	"github.com/webbuilder/api/internal/dnscloud"
	"github.com/webbuilder/api/internal/dnsprovider"
	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/invoices"
	"github.com/webbuilder/api/internal/metrics"
	"github.com/webbuilder/api/internal/registrar"
	"github.com/webbuilder/api/internal/sites"
	"github.com/webbuilder/api/internal/zones"
)


// AssignmentChecker — dependency untuk on-behalf-of verify. Interface, bukan
// concrete import ke reseller package, untuk cegah import cycle (reseller
// nanti mungkin butuh Purchase repo juga).
type AssignmentChecker interface {
	// HasActiveAssignment return nil kalau managerID mengelola clientID.
	// Return error non-nil kalau tidak ada assignment / sudah revoked.
	HasActiveAssignment(ctx context.Context, managerID, clientID uuid.UUID) error
	// ListManagedClientIDs — client IDs yang di-manage langsung oleh managerID.
	// Dipakai team invoice fan-out (aggregate self + client invoices di
	// portal reseller/agent).
	ListManagedClientIDs(ctx context.Context, managerID uuid.UUID) ([]uuid.UUID, error)
	// ListTeamActorIDs — return caller + team member IDs (agent under reseller).
	// Dipakai untuk aggregate purchases by team scope.
	ListTeamActorIDs(ctx context.Context, callerID uuid.UUID) ([]uuid.UUID, error)
}

// Handler untuk domain purchase flow (2-phase self-sufficient).
//
// User-facing endpoints (JWT):
//   POST /api/v1/domains/check                    — availability + harga
//   POST /api/v1/domains/purchase                 — trigger register via api-registry
//   POST /api/v1/domains/:name/renew              — trigger renew via api-registry
//   GET  /api/v1/domains/purchases/:job_id        — poll job status
//   GET  /api/v1/domains/purchases                — list milik user
//   POST /api/v1/domains/purchases/:job_id/attach — link ke site_id existing
//   POST /api/v1/domains/purchases/:job_id/retry  — re-run EPP CREATE untuk failed job
type Handler struct {
	repo        *Repo
	registrar   *registrar.Client
	users       *auth.Repo
	sites       *sites.Repo      // dipakai Attach untuk verify site ownership
	cloudflare  *cloudflare.Repo // kept for admin DNS editor + legacy; attach flow pakai providerFactory
	platformIPs []string         // dipakai jadi content A record DNS auto-attach
	// providerFactory routes attach ke CF/DNSCloud sesuai admin priority +
	// user choice (purchase.dns_provider_choice). Nil = attach pakai legacy
	// CF default path.
	providerFactory dnsprovider.Factory
	// dnsProvidersRepo = raw config repo untuk admin diagnostic endpoint
	// (DNSCloudInfo) yang butuh api_token mentah, bukan via Provider
	// interface. Nil = DNSCloud health panel disabled.
	dnsProvidersRepo DNSProvidersReader
	assignments     AssignmentChecker // nil = on-behalf-of disabled (Phase 3)
	audit           *audit.Repo       // nil = audit disabled
	zonesRepo       *zones.Repo       // nil = trust upstream AllowedZones (legacy)

	// --- 2-phase self-sufficient dependencies (Purchase flow) ---
	// Semua nil-safe: kalau salah satu belum di-wire, Purchase endpoint
	// return 503 dengan pesan jelas mana yang missing.
	pricingRepo PricingLookup     // fetch retail price per TLD
	invoicesSvc InvoiceCreator    // create invoice + apply PPN
	gwRegistry  GatewayRegistry   // resolve payment gateway by code
	promos      PromoValidator    // validate + redeem promo (nil = feature off)

	// onTopupPaid — callback untuk invoice.kind=topup. Wired dari main.go
	// pointing ke wallet_local.MarkTopupCredited. Nil = topup feature off
	// (ExecuteAfterPayment reject dengan error jelas).
	onTopupPaid func(ctx context.Context, inv *invoices.Invoice) error
}

// PricingLookup — abstraksi minimal: dapatkan retail price per TLD.
// Diimplementasikan oleh pricing.Repo (via adapter di main.go).
type PricingLookup interface {
	// GetPlatformPrice — retail baseline. Dipakai purchase flow untuk hitung
	// invoice line kalau client self-purchase.
	GetPlatformPrice(ctx context.Context, tld string) (retailRegister int64, retailRenew int64, err error)
	// GetChargePrice — resolve harga final yang bakal di-charge ke `userID`
	// berdasarkan role (client=retail, reseller=wholesale, agent=agent_price
	// dari reseller list). Dipakai wizard Check untuk preview harga sesuai
	// role supaya angka yang tampil sama dengan yang bakal di-charge.
	GetChargePrice(ctx context.Context, tld string, userID uuid.UUID) (register int64, renew int64, currency string, err error)
}

// InvoiceCreator — abstraksi minimal: buat invoice untuk register/renew.
// Diimplementasikan oleh invoices.Service (+ Repo via adapter).
type InvoiceCreator interface {
	CreateForRegister(ctx context.Context, in InvoiceCreateInput) (invoiceID uuid.UUID, total int64, dueAt time.Time, err error)
	SavePaymentRef(ctx context.Context, id uuid.UUID, providerRef string) error
	// MarkPaid — untuk sync gateway (wallet) — bypass webhook, langsung
	// tandai paid.
	MarkPaid(ctx context.Context, id uuid.UUID, paidAt time.Time, providerRef string) error
	// GetInvoiceForCallback — fetch invoice + lines untuk pass ke
	// ExecuteAfterPayment callback (butuh metadata untuk parse kind/domain/years).
	GetInvoiceForCallback(ctx context.Context, id uuid.UUID) (*invoices.Invoice, error)
}

// InvoiceCreateInput — subset yang Purchase butuh; abstract dari
// invoices.CreateForRegisterInput supaya package tidak import cycle.
type InvoiceCreateInput struct {
	UserID        uuid.UUID
	PurchasedBy   *uuid.UUID // nil = self-purchase; set kalau reseller/agent beli untuk klien
	Domain        string
	Years         int
	UnitPrice     int64
	PaymentMethod string
	Kind          string // "register" | "renew"
	JobID         string
	// Promo — opsional. Kalau di-apply, subtotal invoice berkurang. Code
	// disimpan di metadata untuk audit; discount di-line item.
	PromoCode     string
	PromoDiscount int64
}

// GatewayRegistry — abstraksi resolve gateway.
type GatewayRegistry interface {
	Get(ctx context.Context, code string) (PaymentGateway, error)
}

// PaymentGateway — subset dari paymentgw.Gateway yang Purchase pakai.
type PaymentGateway interface {
	Code() string
	Type() string // "gateway" | "manual" | "wallet" — dipakai handler untuk
	              // dispatch flow (sync wallet vs async webhook).
	CreateCharge(ctx context.Context, req GatewayChargeRequest) (paymentURL string, providerRefID string, err error)
}

// GatewayChargeRequest — subset dari paymentgw.ChargeRequest. Include UserID
// supaya WalletGateway tahu user mana yang di-debit.
type GatewayChargeRequest struct {
	OrderID     string
	UserID      string
	Amount      int64
	Description string
	CustomerName, CustomerEmail, CustomerPhone string
	ReturnURL   string
	NotifURL    string
	ExpiresAt   time.Time

	// WalletPayerID — override debit target untuk wallet gateway. Kalau
	// agent trigger purchase, ini = parent_reseller_id (bukan agent.ID).
	WalletPayerID string
	// WalletMetadata — JSON attached ke wallet_ledger.metadata (mis.
	// {"agent_id":"<uuid>","for_client_id":"<uuid>"}). Reseller pakai buat
	// report per-agent.
	WalletMetadata []byte
}

// PromoValidator — abstraksi validate + redeem promo. Nil = promo feature
// disabled (code apapun akan di-abaikan). Diimplementasi oleh
// promos.Service via adapter di main.go.
type PromoValidator interface {
	// Validate — cek constraint promo terhadap konteks. Return discount
	// yang boleh di-apply + promo ID untuk redemption trail. Error yang
	// user-facing sudah di-map di service.
	Validate(ctx context.Context, code string, userID uuid.UUID, tld, kind string, subtotal int64) (promoID uuid.UUID, discount int64, err error)
	// Redeem — commit redemption (insert row promo_redemptions). Dipanggil
	// setelah invoice created supaya invoice_id available. Idempotent via
	// unique(invoice_id).
	Redeem(ctx context.Context, promoID, userID, invoiceID uuid.UUID, discount int64) error
}

// SetProviderFactory inject DNS provider factory. Kalau nil, tryAttachToDNS
// jatuh ke legacy path (CF default via h.cloudflare). Kalau set, routing
// honor admin priority + user choice (purchase.dns_provider_choice).
func (h *Handler) SetProviderFactory(f dnsprovider.Factory) { h.providerFactory = f }

// SetDNSProvidersRepo inject raw config repo. Diperlukan oleh admin
// diagnostic endpoint (DNSCloudInfo) yang butuh baca api_token mentah untuk
// buat raw backend client — bukan via Provider interface yang disamakan.
func (h *Handler) SetDNSProvidersRepo(r DNSProvidersReader) { h.dnsProvidersRepo = r }

// DNSProvidersReader is the subset of dns_providers.Repo needed by this
// handler. Interface pattern keeps domain_purchase from importing
// dns_providers directly (avoid import cycle at the config-loading layer).
type DNSProvidersReader interface {
	GetByID(ctx context.Context, id uuid.UUID) (*DNSProvidersConfig, error)
}

// DNSProvidersConfig mirrors the subset of dns_providers.Config this handler
// cares about. Keeps domain_purchase decoupled from the full Repo type.
type DNSProvidersConfig struct {
	ID        uuid.UUID
	Kind      string
	Name      string
	APIToken  string
	AccountID string
}

// SetZones inject local zones source. Kalau di-set, handler filter
// hasil check untuk hanya expose TLD yang active di local table (per
// arsitektur self-sufficient — operator kontrol full atas zone yang expose).
func (h *Handler) SetZones(z *zones.Repo) { h.zonesRepo = z }

// SetPricing inject pricing lookup untuk Purchase flow.
func (h *Handler) SetPricing(p PricingLookup) { h.pricingRepo = p }

// SetInvoices inject invoice creator untuk Purchase flow.
func (h *Handler) SetInvoices(i InvoiceCreator) { h.invoicesSvc = i }

// SetGatewayRegistry inject payment gateway registry untuk Purchase.
func (h *Handler) SetGatewayRegistry(g GatewayRegistry) { h.gwRegistry = g }

// SetPromos inject promo validator/redeem. Nil = fitur promo disabled
// (semua code akan return "not found" saat validate).
func (h *Handler) SetPromos(p PromoValidator) { h.promos = p }

// SetOnTopupPaid inject callback untuk invoice.kind=topup. ExecuteAfterPayment
// dispatch ke sini alih-alih EPP execute. Nil-safe: kalau nil, topup
// invoice paid akan return error clear.
func (h *Handler) SetOnTopupPaid(fn func(ctx context.Context, inv *invoices.Invoice) error) {
	h.onTopupPaid = fn
}

// SetAudit inject audit repo untuk record purchase / retry / renew (Phase 7).
func (h *Handler) SetAudit(r *audit.Repo) { h.audit = r }

// logAudit fire-and-forget helper — pattern sama dengan admin/reseller handler.
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

// SetAssignmentChecker — wire-up dari main.go setelah reseller repo dibuat.
// Kalau nil, purchase handler otomatis reject on_behalf_of_user_id.
func (h *Handler) SetAssignmentChecker(a AssignmentChecker) { h.assignments = a }

// NewHandler — cloudflareRepo + platformIPs optional untuk auto-attach.
// Kalau salah satu nil/empty, auto-attach ke Cloudflare skipped tanpa error
// (log warn saja). platformIPs biasanya dari cfg.PlatformIPs.
func NewHandler(
	repo *Repo, r *registrar.Client, users *auth.Repo, sitesRepo *sites.Repo,
	cloudflareRepo *cloudflare.Repo, platformIPs []string,
) *Handler {
	return &Handler{
		repo: repo, registrar: r, users: users, sites: sitesRepo, cloudflare: cloudflareRepo,
		platformIPs:   platformIPs,
	}
}

// ------------- Requests / responses -------------

type checkReq struct {
	// Domain bisa full FQDN ("myshop.co.id") atau SLD-only ("myshop"). Registrar
	// yang decide behavior — SLD-only → return results per allowed zone; full →
	// return 1 entry.
	Domain string `json:"domain"`
}

// checkResp = envelope shape identik dengan registrar (passthrough).
// Frontend cukup baca `results` array; kalau length 1 tampilkan single card,
// length >1 tampilkan grid. `allowed_zones` untuk hint UI.
type checkResp struct {
	Query        string        `json:"query"`
	AllowedZones []string      `json:"allowed_zones"`
	Results      []checkEntry  `json:"results"`
}

type checkEntry struct {
	Domain    string      `json:"domain"`
	TLD       string      `json:"tld"`
	Available bool        `json:"available"`
	Reason    string      `json:"reason,omitempty"`
	Price     *priceBlock `json:"price,omitempty"`
	Zone      *zoneBlock  `json:"zone,omitempty"`
}

type priceBlock struct {
	Currency string  `json:"currency"`
	Register float64 `json:"register"`
	Renew    float64 `json:"renew"`
	Transfer float64 `json:"transfer"`
}

// zoneBlock — flag dari zones catalog lokal. Frontend pakai untuk tentukan
// flow post-payment (kalau require_document=true, tampilkan document picker;
// kalau nik_auto_approved=true, NIK cukup tanpa upload).
type zoneBlock struct {
	Name            string `json:"name"`
	RequireDocument bool   `json:"require_document"`
	AutoApproved    bool   `json:"auto_approved"`
	NikAutoApproved bool   `json:"nik_auto_approved"`
}

type purchaseResp struct {
	JobID         string  `json:"job_id"`
	Domain        string  `json:"domain"`
	Status        string  `json:"status"`
	Kind          string  `json:"kind"` // "register" | "renew" — frontend adapt UI
	Reason        string  `json:"reason,omitempty"`
	PaymentURL    string  `json:"payment_url,omitempty"`
	// PaymentMethod — code payment method yang dipilih (mis. "midtrans",
	// "manual_bank"). Frontend pakai untuk render UI yang tepat: gateway =
	// tombol redirect, manual_bank = instruksi transfer + berita + bank list.
	PaymentMethod string `json:"payment_method,omitempty"`
	// Years — lama registrasi (dari purchase.Years). Frontend pakai untuk
	// display detail invoice tanpa second-fetch.
	Years     int    `json:"years,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"` // RFC3339 saat kind=register && status=active
	// UpdatedAt — timestamp last state transition. Frontend pakai buat
	// detect "stuck": kalau pending_provisioning > 60 detik, offer retry
	// manual.
	UpdatedAt string `json:"updated_at,omitempty"`
	// SiteID di-set kalau user sudah attach purchase ini ke sites row (via
	// POST /sites/from-template/:slug atau /purchases/:job_id/attach).
	// Nil = domain aktif tapi belum ada situs → frontend prompt user pilih
	// template. Frontend pakai ini untuk decide CTA "Buat situs" vs "Edit situs".
	SiteID *string `json:"site_id,omitempty"`
}

// ------------- User endpoints -------------

func (h *Handler) Check(c *fiber.Ctx) error {
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled",
			"Fitur domain belum dikonfigurasi (API_REGISTRY_URL kosong).")
	}
	var req checkReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.Domain = strings.ToLower(strings.TrimSpace(req.Domain))
	if req.Domain == "" {
		return httpx.BadRequest(c, "domain kosong")
	}

	// api-registry (epp_direct mode) hanya terima FQDN. Kalau user cuma
	// input SLD (mis. "myshop"), expand ke N FQDN dari zones catalog + fan-out
	// parallel check per-zone → aggregate response.
	res, err := h.checkDomain(c.Context(), req.Domain)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "registrar_error", err.Error())
	}
	// Cross-check dengan local zones catalog: kalau zonesRepo di-set,
	// operator kontrol TLD apa yang expose ke user (bukan trust upstream).
	// Zone yang active=false di local akan drop dari response walau
	// upstream masih support.
	allowedLocal, allowedSet := h.resolveAllowedZones(c.Context(), res.AllowedZones)

	out := checkResp{
		Query:        res.Query,
		AllowedZones: allowedLocal,
		Results:      make([]checkEntry, 0, len(res.Results)),
	}
	for _, r := range res.Results {
		// Filter per-entry — kalau TLD tidak active di local, skip.
		if allowedSet != nil {
			if _, ok := allowedSet[strings.ToLower(r.TLD)]; !ok {
				continue
			}
		}
		e := checkEntry{
			Domain:    r.Domain,
			TLD:       r.TLD,
			Available: r.Available,
			Reason:    r.Reason,
		}
		if r.Price != nil {
			e.Price = &priceBlock{
				Currency: r.Price.Currency,
				Register: r.Price.Register,
				Renew:    r.Price.Renew,
				Transfer: r.Price.Transfer,
			}
		}
		if r.Zone != nil {
			e.Zone = &zoneBlock{
				Name:            r.Zone.Name,
				RequireDocument: r.Zone.RequireDocument,
				AutoApproved:    r.Zone.AutoApproved,
				NikAutoApproved: r.Zone.NikAutoApproved,
			}
		}
		out.Results = append(out.Results, e)
	}

	// Enrich Price + Zone dari local catalog. api-registry (SaaS mode) tidak
	// expose harga/zone → web builder yang authoritative. Cache per-TLD
	// supaya query DB tidak diulang untuk SLD input yang expand ke multi zone.
	h.enrichCheckResults(c.Context(), auth.UserIDFrom(c), out.Results)

	return httpx.OK(c, out)
}

// enrichCheckResults — populate Price + Zone dari platform_prices + zones
// tables. Nil-safe: kalau pricingRepo/zonesRepo belum di-wire, no-op (frontend
// tetap show entry tanpa harga — user bakal dapat error saat purchase).
func (h *Handler) enrichCheckResults(ctx context.Context, userID uuid.UUID, results []checkEntry) {
	if len(results) == 0 {
		return
	}
	priceCache := map[string]*priceBlock{}
	zoneCache := map[string]*zoneBlock{}
	for i := range results {
		e := &results[i]
		tld := strings.ToLower(e.TLD)
		if tld == "" || !e.Available {
			continue // taken domain: tidak perlu harga
		}
		// Price — kalau upstream tidak set (default kasus api-registry mode).
		if e.Price == nil && h.pricingRepo != nil {
			if p, ok := priceCache[tld]; ok {
				e.Price = p
			} else {
				reg, ren, currency, err := h.pricingRepo.GetChargePrice(ctx, tld, userID)
				if err == nil {
					p := &priceBlock{
						Currency: currency,
						Register: float64(reg),
						Renew:    float64(ren),
					}
					priceCache[tld] = p
					e.Price = p
				} else {
					priceCache[tld] = nil // negative cache untuk cegah requery
				}
			}
		}
		// Zone flags — dipakai frontend untuk trigger doc picker + NIK hint.
		if e.Zone == nil && h.zonesRepo != nil {
			if z, ok := zoneCache[tld]; ok {
				e.Zone = z
			} else {
				z, err := h.zonesRepo.GetByTLD(ctx, tld)
				if err == nil && z != nil {
					zb := &zoneBlock{
						Name:            z.TLD,
						RequireDocument: z.RequireDocument,
						AutoApproved:    z.AutoApproved,
						NikAutoApproved: z.NikAutoApproved,
					}
					zoneCache[tld] = zb
					e.Zone = zb
				} else {
					zoneCache[tld] = nil
				}
			}
		}
	}
}

// checkDomain — wrapper around registrar.CheckDomain yang handle SLD input.
//
// api-registry hanya terima FQDN. Kalau user input:
//   - FQDN ("myshop.id"): forward as-is
//   - SLD ("myshop"): expand ke N FQDN via active zones, fan-out parallel,
//     aggregate results
//
// Kalau zonesRepo nil + input SLD → error (frontend harus provide TLD).
func (h *Handler) checkDomain(ctx context.Context, input string) (*registrar.DomainCheckResponse, error) {
	if strings.Contains(input, ".") {
		// FQDN input — kalau SLD premium (terlalu pendek untuk .id),
		// langsung tandai unavailable tanpa panggil EPP. Save 1 round-trip.
		if err := validateDomainLength(input); err != nil {
			// Extract TLD inline (strings.SplitN pattern) — first dot
			// adalah separator SLD, sisanya TLD.
			tld := ""
			if idx := strings.Index(input, "."); idx > 0 {
				tld = input[idx+1:]
			}
			return &registrar.DomainCheckResponse{
				Query: input,
				Results: []registrar.DomainCheckEntry{
					{
						Domain:    input,
						TLD:       tld,
						Available: false,
						Reason:    err.Error(),
					},
				},
			}, nil
		}
		return h.registrar.CheckDomain(ctx, input)
	}
	// SLD path — butuh zones catalog untuk expand.
	if h.zonesRepo == nil {
		return nil, fmt.Errorf("input harus FQDN (mis. %s.id) — zones catalog belum aktif", input)
	}
	activeZones, err := h.zonesRepo.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("gagal ambil zones: %w", err)
	}
	if len(activeZones) == 0 {
		return nil, fmt.Errorf("belum ada zone aktif — admin harus konfigurasi TLD dulu")
	}

	// Fan-out parallel — 1 goroutine per zone. Cap timeout via ctx dari
	// caller. Kalau ada zone yang error, log + skip (partial result lebih
	// baik dari total fail).
	type slot struct {
		entry registrar.DomainCheckEntry
		ok    bool
	}
	slots := make([]slot, len(activeZones))
	allowedZones := make([]string, 0, len(activeZones))
	for _, z := range activeZones {
		allowedZones = append(allowedZones, z.TLD)
	}

	var wg sync.WaitGroup
	for i, z := range activeZones {
		i, z := i, z
		fqdn := input + "." + z.TLD
		// Pre-check premium length — skip EPP call untuk SLD yang pasti ditolak.
		// Hemat round-trip + tampilkan reason konsisten di grid.
		if err := validateDomainLength(fqdn); err != nil {
			slots[i] = slot{
				entry: registrar.DomainCheckEntry{
					Domain:    fqdn,
					TLD:       z.TLD,
					Available: false,
					Reason:    err.Error(),
				},
				ok: true,
			}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := h.registrar.CheckDomain(ctx, fqdn)
			if err != nil {
				slog.Warn("check: zone fan-out failed",
					"domain", fqdn, "tld", z.TLD, "error", err)
				return
			}
			// api-registry return array of 1 entry untuk FQDN input.
			for _, r := range res.Results {
				if strings.EqualFold(r.Domain, fqdn) {
					slots[i] = slot{entry: r, ok: true}
					return
				}
			}
			// Fallback: kalau backend tidak return domain yang match,
			// bikin entry "unknown" supaya user tetap lihat TLD di grid.
			slots[i] = slot{
				entry: registrar.DomainCheckEntry{
					Domain:    fqdn,
					TLD:       z.TLD,
					Available: false,
					Reason:    "check gagal",
				},
				ok: true,
			}
		}()
	}
	wg.Wait()

	out := &registrar.DomainCheckResponse{
		Query:        input,
		AllowedZones: allowedZones,
		Results:      make([]registrar.DomainCheckEntry, 0, len(slots)),
	}
	for _, s := range slots {
		if s.ok {
			out.Results = append(out.Results, s.entry)
		}
	}
	if len(out.Results) == 0 {
		return nil, fmt.Errorf("semua zone check gagal — cek koneksi ke registry")
	}
	return out, nil
}

// resolveAllowedZones — kalau zonesRepo di-set, return list local active zones
// sebagai UI hint + membership set untuk filter per-entry.
//
// SEBELUMNYA: fungsi intersect upstream × local buat `AllowedZones` response.
// BUG: kalau user cek TLD yang tidak dilayani (mis. "foo.thistldnotserved"),
// api-registry echo TLD input di upstream.AllowedZones. Local set beda → intersect
// kosong → response allowed_zones=[] → frontend tampilkan "belum ada zona"
// padahal admin sudah aktifkan beberapa TLD. Ini regresi visibility, bukan gate
// security (filter per-entry di Check() line 342-346 pakai `allowedSet` yang tetap
// dihitung dari local).
//
// FIX: `AllowedZones` field response = **selalu** list local active TLD (source
// of truth admin), tidak intersect dengan upstream. Frontend butuh ini sebagai
// suggestion chips supaya user tahu opsi TLD valid.
func (h *Handler) resolveAllowedZones(ctx context.Context, upstream []string) ([]string, map[string]struct{}) {
	if h.zonesRepo == nil {
		// Legacy mode (belum ada zones catalog) — trust upstream sepenuhnya.
		return upstream, nil
	}
	local, err := h.zonesRepo.ListActive(ctx)
	if err != nil {
		// Fallback: trust upstream kalau local query fail. Log warn supaya
		// operator visible ada masalah (sebelumnya silent swallow).
		slog.Warn("resolveAllowedZones: local ListActive failed, fallback upstream",
			"error", err, "upstream_count", len(upstream))
		return upstream, nil
	}
	localSet := make(map[string]struct{}, len(local))
	localTLDs := make([]string, 0, len(local))
	for _, z := range local {
		localSet[strings.ToLower(z.TLD)] = struct{}{}
		localTLDs = append(localTLDs, z.TLD)
	}
	return localTLDs, localSet
}

// Audit event constants — dipakai lokal supaya tidak import cycle string
// literal ke package audit. Match dengan audit.EventDomain* di paket sana.
const (
	EventPurchaseCreated    = audit.EventDomainPurchased
	EventPurchaseOnBehalfOf = audit.EventDomainPurchasedOBO
)

// Status — dipakai frontend polling. Kalau status lokal masih pending +
// belum ada payment_url, hit registrar (mungkin sudah generate). Kalau sudah
// terminal, cukup baca dari cache lokal.
func (h *Handler) Status(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	jobID := c.Params("job_id")
	if jobID == "" {
		return httpx.BadRequest(c, "job_id required")
	}
	// Actor-inclusive lookup: reseller/agent yang beli on-behalf-of tetap boleh
	// poll walaupun user_id purchase = client_id.
	local, err := h.repo.GetByJobIDForActor(c.Context(), jobID, cl.UserID)
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "job tidak ditemukan")
	}
	if err != nil {
		return httpx.Internal(c, "lookup failed")
	}

	// Self-sufficient: local DB authoritative. Status update via
	// ExecuteAfterPayment (webhook) atau Retry langsung tulis ke DB —
	// tidak butuh refresh dari external source.
	return httpx.OK(c, toResp(local))
}

// GetNameservers — GET /api/v1/domains/:name/nameservers
//
// Verify ownership dulu (user harus punya active register-job untuk domain
// ini), lalu proxy ke registrar. Ownership check ganda: web builder DB +
// registrar-side check.
func (h *Handler) GetNameservers(c *fiber.Ctx) error {
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled",
			"Registrar API belum dikonfigurasi.")
	}
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}
	if _, err := h.repo.GetLatestActiveByDomain(c.Context(), name, cl.UserID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan atau bukan milik Anda")
		}
		return httpx.Internal(c, "ownership check failed")
	}
	info, err := h.registrar.GetNameservers(c.Context(), name)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "registrar_error", err.Error())
	}
	return httpx.OK(c, info)
}

// UpdateNameservers — POST /api/v1/domains/:name/nameservers
// Body: { nameservers: [ "ns1.example.com", ... ] } (min 2, max 13)
func (h *Handler) UpdateNameservers(c *fiber.Ctx) error {
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled",
			"Registrar API belum dikonfigurasi.")
	}
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}

	var req struct {
		Nameservers []string `json:"nameservers"`
	}
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	// Trim + drop empty upfront; registrar validate hostname format lebih ketat.
	cleaned := make([]string, 0, len(req.Nameservers))
	for _, n := range req.Nameservers {
		if v := strings.ToLower(strings.TrimSpace(n)); v != "" {
			cleaned = append(cleaned, v)
		}
	}
	if len(cleaned) < 2 {
		return httpx.BadRequest(c, "minimal 2 nameserver")
	}
	if len(cleaned) > 13 {
		return httpx.BadRequest(c, "maksimal 13 nameserver")
	}

	if _, err := h.repo.GetLatestActiveByDomain(c.Context(), name, cl.UserID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan atau bukan milik Anda")
		}
		return httpx.Internal(c, "ownership check failed")
	}

	info, err := h.registrar.UpdateNameservers(c.Context(), name, cleaned)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "registrar_error", err.Error())
	}
	return httpx.OK(c, info)
}

// dnsPrecheck — helper untuk DNS handlers. Verify:
//  1. Cloudflare config tersedia (kalau tidak, 503 "cf_disabled")
//  2. Domain milik user yang login (via GetLatestActiveByDomain — same lock
//     yang dipakai renew + nameserver flow)
//  3. Zone terdaftar di CF akun kita (mungkin belum kalau auto-attach fail)
//
// Return zone_id + client siap pakai, atau error yang sudah ter-write ke
// response (caller cukup return err).
// dnsPrecheck writes the error response itself and returns a nil client on
// failure. Callers must test `client == nil`, not the error: httpx.Err returns
// nil once the JSON is written, so checking the error let handlers run on with
// a nil client and panic.
func (h *Handler) dnsPrecheck(c *fiber.Ctx, name string) (string, *cloudflare.Client, error) {
	if h.cloudflare == nil {
		return "", nil, httpx.Err(c, fiber.StatusServiceUnavailable, "cloudflare_disabled",
			"Fitur DNS belum aktif — admin perlu setup Cloudflare config.")
	}
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return "", nil, httpx.Unauthorized(c, "no claims")
	}
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return "", nil, httpx.BadRequest(c, "name required")
	}
	if _, err := h.repo.GetLatestActiveByDomain(c.Context(), name, cl.UserID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", nil, httpx.NotFound(c, "domain tidak ditemukan atau bukan milik Anda")
		}
		return "", nil, httpx.Internal(c, "ownership check failed")
	}
	cfg, err := h.cloudflare.GetDefault(c.Context())
	if err != nil {
		if errors.Is(err, cloudflare.ErrNotFound) {
			return "", nil, httpx.Err(c, fiber.StatusServiceUnavailable, "cloudflare_no_config",
				"Cloudflare default config belum di-set. Hubungi admin.")
		}
		return "", nil, httpx.Internal(c, "cloudflare config lookup failed")
	}
	client := cloudflare.NewClient(*cfg)
	zone, err := client.GetZoneByDomain(c.Context(), name)
	if err != nil {
		if errors.Is(err, cloudflare.ErrZoneNotFound) {
			return "", nil, httpx.Err(c, fiber.StatusNotFound, "zone_not_found",
				"Zone Cloudflare untuk domain ini belum tersedia — biasanya muncul beberapa menit setelah pembelian selesai.")
		}
		return "", nil, httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	return zone.ID, client, nil
}

// CloudflareInfo — GET /api/v1/domains/:name/cloudflare-info
//
// Health-check summary Cloudflare: zone status + NS + apex/www records +
// perbandingan NS antara CF vs registrar (PANDI). Dipakai halaman detail
// domain untuk troubleshoot "domain tidak bisa diakses".
//
// Response include `checks` object dengan boolean per-check supaya UI bisa
// langsung render icon ✅/⚠️ tanpa parse ulang.
func (h *Handler) CloudflareInfo(c *fiber.Ctx) error {
	zoneID, client, errResp := h.dnsPrecheck(c, c.Params("name"))
	if client == nil {
		return errResp
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))

	// Zone info — status + NS assigned CF.
	zone, err := client.GetZoneByDomain(c.Context(), name)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	// DNS records — supaya bisa cek apex + www.
	records, err := client.ListDNSRecords(c.Context(), zoneID)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	// NS current di registrar — untuk bandingkan sama NS CF.
	nsAtRegistrar := []string{}
	if h.registrar != nil {
		if info, err := h.registrar.GetNameservers(c.Context(), name); err == nil && info != nil {
			nsAtRegistrar = info.Nameservers
		}
	}

	// Analyze health checks.
	apex := findRecord(records, "A", name)
	www := findRecord(records, "CNAME", "www."+name)
	pointsToPlatform := false
	if apex != nil {
		for _, ip := range h.platformIPs {
			if apex.Content == ip {
				pointsToPlatform = true
				break
			}
		}
	}
	nsSynced := nsListsEqual(zone.NameServers, nsAtRegistrar)

	return httpx.OK(c, fiber.Map{
		"zone": fiber.Map{
			"id":           zone.ID,
			"status":       zone.Status,
			"name_servers": zone.NameServers,
		},
		"records":                  records,
		"nameservers_at_registrar": nsAtRegistrar,
		"platform_ips":             h.platformIPs,
		"checks": fiber.Map{
			"zone_active":              zone.Status == "active",
			"ns_synced":                nsSynced,
			"apex_present":             apex != nil,
			"apex_points_to_platform":  pointsToPlatform,
			"www_present":              www != nil,
		},
	})
}

// findRecord — return first DNS record match by type + name. Nil kalau
// tidak ada. Case-insensitive name compare.
func findRecord(records []cloudflare.DNSRecordData, typ, name string) *cloudflare.DNSRecordData {
	for i := range records {
		r := &records[i]
		if strings.EqualFold(r.Type, typ) && strings.EqualFold(r.Name, name) {
			return r
		}
	}
	return nil
}

// nsListsEqual — case-insensitive set compare. Cek apakah NS di CF match
// dengan NS di registrar (order-independent).
func nsListsEqual(a, b []string) bool {
	if len(a) != len(b) || len(a) == 0 {
		return false
	}
	set := make(map[string]struct{}, len(a))
	for _, s := range a {
		set[strings.ToLower(strings.TrimRight(s, "."))] = struct{}{}
	}
	for _, s := range b {
		if _, ok := set[strings.ToLower(strings.TrimRight(s, "."))]; !ok {
			return false
		}
	}
	return true
}

// ListDNSRecords — GET /api/v1/domains/:name/dns
//
// Return semua DNS record di zone Cloudflare untuk domain ini. Payload
// dikirim apa adanya dari CF (id, type, name, content, ttl, proxied,
// priority, comment) — frontend bebas render tabel + filter.
func (h *Handler) ListDNSRecords(c *fiber.Ctx) error {
	zoneID, client, errResp := h.dnsPrecheck(c, c.Params("name"))
	if client == nil {
		return errResp
	}
	records, err := client.ListDNSRecords(c.Context(), zoneID)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	return httpx.OK(c, fiber.Map{"records": records, "zone_id": zoneID})
}

// dnsRecordReq = payload create/update dari frontend. Field mirror
// cloudflare.DNSRecordRequest tapi kita re-declare supaya bisa validate +
// friendly error message sebelum forward.
type dnsRecordReq struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	TTL      int    `json:"ttl"`
	Proxied  bool   `json:"proxied"`
	Priority *int   `json:"priority,omitempty"`
	Comment  string `json:"comment,omitempty"`
}

// validDNSTypes whitelist supaya user tidak forward type aneh yang bikin
// CF error 400. Cover 99% use case UMKM (verifikasi email, custom subdomain,
// mail routing).
var validDNSTypes = map[string]bool{
	"A": true, "AAAA": true, "CNAME": true, "TXT": true,
	"MX": true, "NS": true, "SRV": true, "CAA": true,
}

func (r *dnsRecordReq) validate() error {
	r.Type = strings.ToUpper(strings.TrimSpace(r.Type))
	r.Name = strings.TrimSpace(r.Name)
	r.Content = strings.TrimSpace(r.Content)
	if !validDNSTypes[r.Type] {
		return errors.New("type harus salah satu: A, AAAA, CNAME, TXT, MX, NS, SRV, CAA")
	}
	if r.Name == "" {
		return errors.New("name wajib (@ untuk root, atau subdomain seperti 'www')")
	}
	if r.Content == "" {
		return errors.New("content wajib")
	}
	// Proxied hanya berlaku A/AAAA/CNAME. CF ignore untuk type lain, tapi kita
	// force false supaya payload konsisten.
	if r.Type != "A" && r.Type != "AAAA" && r.Type != "CNAME" {
		r.Proxied = false
	}
	if r.Type == "MX" && r.Priority == nil {
		return errors.New("priority wajib untuk record MX")
	}
	// TTL: 1 = auto, else 60..86400
	if r.TTL != 1 && (r.TTL < 60 || r.TTL > 86400) {
		if r.TTL == 0 {
			r.TTL = 1
		} else {
			return errors.New("TTL harus 1 (auto) atau antara 60 dan 86400 detik")
		}
	}
	if len(r.Comment) > 100 {
		return errors.New("comment maksimal 100 karakter")
	}
	return nil
}

// CreateDNSRecord — POST /api/v1/domains/:name/dns
// Body: dnsRecordReq
func (h *Handler) CreateDNSRecord(c *fiber.Ctx) error {
	zoneID, client, errResp := h.dnsPrecheck(c, c.Params("name"))
	if client == nil {
		return errResp
	}
	var req dnsRecordReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	if err := req.validate(); err != nil {
		return httpx.BadRequest(c, err.Error())
	}
	rec, err := client.CreateDNSRecord(c.Context(), zoneID, cloudflare.DNSRecordRequest{
		Type: req.Type, Name: req.Name, Content: req.Content,
		TTL: req.TTL, Proxied: req.Proxied, Priority: req.Priority,
		Comment: req.Comment,
	})
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	return httpx.Created(c, rec)
}

// UpdateDNSRecord — PATCH /api/v1/domains/:name/dns/:record_id
func (h *Handler) UpdateDNSRecord(c *fiber.Ctx) error {
	zoneID, client, errResp := h.dnsPrecheck(c, c.Params("name"))
	if client == nil {
		return errResp
	}
	recordID := strings.TrimSpace(c.Params("record_id"))
	if recordID == "" {
		return httpx.BadRequest(c, "record_id required")
	}
	var req dnsRecordReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	if err := req.validate(); err != nil {
		return httpx.BadRequest(c, err.Error())
	}
	rec, err := client.UpdateDNSRecord(c.Context(), zoneID, recordID, cloudflare.DNSRecordRequest{
		Type: req.Type, Name: req.Name, Content: req.Content,
		TTL: req.TTL, Proxied: req.Proxied, Priority: req.Priority,
		Comment: req.Comment,
	})
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	return httpx.OK(c, rec)
}

// DeleteDNSRecord — DELETE /api/v1/domains/:name/dns/:record_id
func (h *Handler) DeleteDNSRecord(c *fiber.Ctx) error {
	zoneID, client, errResp := h.dnsPrecheck(c, c.Params("name"))
	if client == nil {
		return errResp
	}
	recordID := strings.TrimSpace(c.Params("record_id"))
	if recordID == "" {
		return httpx.BadRequest(c, "record_id required")
	}
	if err := client.DeleteDNSRecord(c.Context(), zoneID, recordID); err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	return httpx.OK(c, fiber.Map{"ok": true})
}

// Whois — GET /api/v1/domains/:name/whois
//
// Return WHOIS info dari registrar. Ownership required — kita tidak expose
// public WHOIS ke sembarang user, biar registrar tidak kena rate-limit
// karena user iseng ngecek domain orang lain via web builder.
func (h *Handler) Whois(c *fiber.Ctx) error {
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled",
			"Registrar API belum dikonfigurasi.")
	}
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}
	if _, err := h.repo.GetLatestActiveByDomain(c.Context(), name, cl.UserID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan atau bukan milik Anda")
		}
		return httpx.Internal(c, "ownership check failed")
	}
	w, err := h.registrar.Whois(c.Context(), name)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "registrar_error", err.Error())
	}
	if w == nil {
		// Whois() return (nil, nil) kalau domain tidak terdaftar — aneh untuk
		// domain milik user (active). Return empty struct, biar frontend
		// tetap render tanpa crash.
		return httpx.OK(c, map[string]string{"domain": name, "status": "unknown"})
	}
	return httpx.OK(c, w)
}

// UpdateContact — PATCH /api/v1/domains/:name/contact
// Body: Contact fields (name, email, phone, address, city, state, postal_code)
//
// Update WHOIS contact object untuk domain existing. Semua field WAJIB
// (EPP replace-all — kalau tidak dikirim, wipe di registry). Ownership
// check dulu: domain harus punya active job milik user.
//
// Response contain `message` dari api-registry yang bisa jadi 3 varian:
//   - "DB + EPP registry synced" — happy path
//   - "DB only, EPP drift" — registry down / diff detected, admin follow-up
//   - "created new contact" — kalau nic_handle belum ada
type updateContactReq struct {
	Name       string `json:"name"`
	Email      string `json:"email"`
	Phone      string `json:"phone"`
	Address    string `json:"address"`
	City       string `json:"city"`
	State      string `json:"state,omitempty"`
	PostalCode string `json:"postal_code"`
}

func (h *Handler) UpdateContact(c *fiber.Ctx) error {
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled",
			"Fitur domain belum dikonfigurasi (API_REGISTRY_URL kosong).")
	}
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}
	// Ownership: user harus punya active job untuk domain ini.
	if _, err := h.repo.GetLatestActiveByDomain(c.Context(), name, cl.UserID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan atau bukan milik Anda")
		}
		return httpx.Internal(c, "ownership check failed")
	}

	var req updateContactReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	// Validate mandatory fields (EPP contact:update tolak kalau incomplete).
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.TrimSpace(req.Email)
	req.Phone = strings.TrimSpace(req.Phone)
	req.Address = strings.TrimSpace(req.Address)
	req.City = strings.TrimSpace(req.City)
	req.PostalCode = strings.TrimSpace(req.PostalCode)
	req.State = strings.TrimSpace(req.State)
	missing := []string{}
	if req.Name == "" {
		missing = append(missing, "name")
	}
	if req.Email == "" {
		missing = append(missing, "email")
	}
	if req.Phone == "" {
		missing = append(missing, "phone")
	}
	if req.Address == "" {
		missing = append(missing, "address")
	}
	if req.City == "" {
		missing = append(missing, "city")
	}
	if req.PostalCode == "" {
		missing = append(missing, "postal_code")
	}
	if len(missing) > 0 {
		return httpx.Err(c, fiber.StatusBadRequest, "contact_incomplete",
			"Field wajib kosong: "+strings.Join(missing, ", "))
	}

	// Format + ASCII validation sebelum hit EPP — RFC 5733 §2.6 PostalInfo
	// type="int" wajib ASCII. Em-dash/aksen/emoji akan di-reject PANDI dengan
	// "Transaction rolled back" cryptic error. Blokir di sini supaya user
	// dapat pesan jelas.
	if !auth.ValidEmail(req.Email) {
		return httpx.BadRequest(c, "format email tidak valid")
	}
	if !auth.ValidPhone(req.Phone) {
		return httpx.BadRequest(c, "nomor HP minimal 7 digit (contoh: +62 812 3456 7890)")
	}
	if !auth.ValidPostalCode(req.PostalCode) {
		return httpx.BadRequest(c, "kode pos harus 4-10 digit angka")
	}
	if !auth.IsASCIIPrintable(req.Name) {
		return httpx.BadRequest(c, "nama hanya boleh karakter ASCII (tanpa aksen atau emoji)")
	}
	if !auth.IsASCIIPrintable(req.Address) {
		return httpx.BadRequest(c, "alamat hanya boleh karakter ASCII (tanpa aksen atau emoji)")
	}
	if !auth.IsASCIIPrintable(req.City) {
		return httpx.BadRequest(c, "nama kota hanya boleh karakter ASCII")
	}
	if req.State != "" && !auth.IsASCIIPrintable(req.State) {
		return httpx.BadRequest(c, "nama provinsi hanya boleh karakter ASCII (mis. em-dash '—', aksen)")
	}

	resp, err := h.registrar.UpdateDomainContact(c.Context(), name, registrar.Contact{
		Name:        req.Name,
		Email:       req.Email,
		Phone:       req.Phone,
		Address:     req.Address,
		City:        req.City,
		State:       req.State,
		PostalCode:  req.PostalCode,
		CountryCode: "ID",
	})
	if err != nil {
		var apiErr *registrar.APIError
		if errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 {
			return httpx.Err(c, apiErr.Status, "contact_update_failed", apiErr.Msg)
		}
		return httpx.Err(c, fiber.StatusBadGateway, "contact_update_failed", err.Error())
	}
	h.logAudit(c.Context(), cl.UserID, "domain.contact_updated", "domain", name, map[string]any{
		"contact_id": resp.ContactID,
		"nic_handle": resp.NicHandle,
	})
	return httpx.OK(c, resp)
}

func (h *Handler) List(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	items, err := h.repo.ListByUser(c.Context(), cl.UserID, limit)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	out := make([]purchaseResp, 0, len(items))
	for i := range items {
		out = append(out, toResp(&items[i]))
	}
	return httpx.OK(c, out)
}

// ExportOnBehalfOfCSV — GET /api/v1/reseller/purchases.csv (Phase 6).
// Streaming CSV dari portfolio domain reseller. Include kolom client info
// supaya bisa dipakai accounting/reconciliation di spreadsheet.
//
// Format: satu row per purchase, kolom sesuai header di line pertama.
// TIDAK paginated — asumsi reseller punya <10k domain (kalau makin besar,
// admin bisa expose paged CSV di route berbeda).
func (h *Handler) ExportOnBehalfOfCSV(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	// Batch 1000 — realistis untuk reseller MVP; kalau butuh lebih, page later.
	items, err := h.repo.ListByPurchaser(c.Context(), cl.UserID, 10000)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	// Enrich client info (email + name) via cache — sama pattern dengan
	// ListOnBehalfOf.
	cache := map[uuid.UUID]*auth.User{}
	lookup := func(id uuid.UUID) *auth.User {
		if u, ok := cache[id]; ok {
			return u
		}
		u, err := h.users.GetByID(c.Context(), id)
		if err == nil && u != nil {
			cache[id] = u
			return u
		}
		return nil
	}

	c.Set("Content-Type", "text/csv; charset=utf-8")
	c.Set("Content-Disposition", `attachment; filename="reseller-domains.csv"`)

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{
		"domain", "kind", "status", "years", "expires_at",
		"client_id", "client_email", "client_name",
		"payment_method", "created_at",
	})
	for i := range items {
		p := &items[i]
		u := lookup(p.UserID)
		email, name := "", ""
		if u != nil {
			email, name = u.Email, u.Name
		}
		exp := ""
		if p.ExpiresAt != nil {
			exp = p.ExpiresAt.UTC().Format(time.RFC3339)
		}
		_ = w.Write([]string{
			p.Domain, p.Kind, p.Status,
			strconv.Itoa(p.Years), exp,
			p.UserID.String(), email, name,
			p.PaymentMethod, p.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	w.Flush()
	return c.Send(buf.Bytes())
}

// domainResp — response shape untuk endpoint /domains (aggregate view).
// Beda dari purchaseResp yang purchase-transaction oriented — ini current
// state per FQDN dengan expires_at + contact_id yg di-cache dari EPP info.
type domainResp struct {
	Name           string  `json:"name"`
	UserID         string  `json:"user_id"`
	PurchasedBy    *string `json:"purchased_by,omitempty"`
	ContactID      string  `json:"contact_id,omitempty"`
	ExpiresAt      string  `json:"expires_at,omitempty"`     // RFC3339
	RegisteredAt   string  `json:"registered_at"`
	LastRenewedAt  string  `json:"last_renewed_at,omitempty"`
	Status         string  `json:"status"`
	SiteID         *string `json:"site_id,omitempty"`
	RegistrarJobID string  `json:"registrar_job_id,omitempty"`
	// Optional enrichment untuk team view (agent/reseller):
	ClientName  string `json:"client_name,omitempty"`
	ClientEmail string `json:"client_email,omitempty"`
}

func domainToResp(d *Domain) domainResp {
	out := domainResp{
		Name:           d.Name,
		UserID:         d.UserID.String(),
		ContactID:      d.ContactID,
		RegisteredAt:   d.RegisteredAt.UTC().Format(time.RFC3339),
		Status:         d.Status,
		RegistrarJobID: d.RegistrarJobID,
	}
	if d.ExpiresAt != nil {
		out.ExpiresAt = d.ExpiresAt.UTC().Format(time.RFC3339)
	}
	if d.LastRenewedAt != nil {
		out.LastRenewedAt = d.LastRenewedAt.UTC().Format(time.RFC3339)
	}
	if d.PurchasedBy != nil {
		s := d.PurchasedBy.String()
		out.PurchasedBy = &s
	}
	if d.SiteID != nil {
		s := d.SiteID.String()
		out.SiteID = &s
	}
	return out
}

// ListDomains — GET /api/v1/domains. Return current-state domain aggregate
// user (dari tabel `domains`, bukan domain_purchases). Sort by expires_at
// ASC (nearest expiry first).
func (h *Handler) ListDomains(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	items, err := h.repo.ListDomainsByUser(c.Context(), cl.UserID)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	out := make([]domainResp, 0, len(items))
	for i := range items {
		out = append(out, domainToResp(&items[i]))
	}
	return httpx.OK(c, out)
}

// ListTeamDomains — GET /api/v1/reseller/domains atau /agent/domains.
// Team scope: reseller include agent-agent nya. Enrich dengan client info
// (owner name/email) supaya UI bisa show "milik X".
func (h *Handler) ListTeamDomains(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	// Team scope: kumpulkan client IDs (owner sites) dari assignments.
	// Reseller: include agent's clients. Agent: direct only.
	if h.assignments == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "assignments_disabled",
			"Fitur team domain belum di-wire.")
	}
	clientIDs, err := h.assignments.ListManagedClientIDs(c.Context(), cl.UserID)
	if err != nil {
		return httpx.Internal(c, "list managed clients failed")
	}
	// Include caller sendiri kalau reseller/agent juga own domain.
	userIDs := append([]uuid.UUID{cl.UserID}, clientIDs...)
	items, err := h.repo.ListDomainsByUsers(c.Context(), userIDs)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	// Enrich client info via cache.
	out := make([]domainResp, 0, len(items))
	cache := map[uuid.UUID]*auth.User{}
	for i := range items {
		p := &items[i]
		r := domainToResp(p)
		if p.UserID != cl.UserID {
			u, ok := cache[p.UserID]
			if !ok {
				if lookup, err := h.users.GetByID(c.Context(), p.UserID); err == nil {
					cache[p.UserID] = lookup
					u = lookup
				}
			}
			if u != nil {
				r.ClientName = u.Name
				r.ClientEmail = u.Email
			}
		}
		out = append(out, r)
	}
	return httpx.OK(c, out)
}

// ListOnBehalfOf — reseller/agent lihat purchase yang mereka trigger untuk
// client (bukan self-purchase). Enrich dengan client email + name supaya UI
// bisa langsung display "domain X untuk klien Y" tanpa second fetch.
//
// Middleware RequireResellerOrAgent sudah enforce role; kita tinggal filter
// purchased_by = caller.
func (h *Handler) ListOnBehalfOf(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	// Team scope: reseller lihat purchase yang dia + agent-nya trigger.
	// Agent hanya lihat purchase-nya sendiri.
	actorIDs := []uuid.UUID{cl.UserID}
	if h.assignments != nil {
		if teamIDs, err := h.assignments.ListTeamActorIDs(c.Context(), cl.UserID); err == nil && len(teamIDs) > 0 {
			actorIDs = teamIDs
		}
	}
	items, err := h.repo.ListByPurchasers(c.Context(), actorIDs, limit)
	if err != nil {
		return httpx.Internal(c, "list failed")
	}
	// Enrich per-row dengan client info. Cache users lookup dalam satu request
	// untuk hindari N+1 saat banyak purchase untuk klien yang sama.
	type row struct {
		purchaseResp
		ClientID    string `json:"client_id"`
		ClientName  string `json:"client_name"`
		ClientEmail string `json:"client_email"`
	}
	out := make([]row, 0, len(items))
	cache := map[uuid.UUID]*auth.User{}
	for i := range items {
		p := &items[i]
		u, ok := cache[p.UserID]
		if !ok {
			if lookup, err := h.users.GetByID(c.Context(), p.UserID); err == nil {
				cache[p.UserID] = lookup
				u = lookup
			}
		}
		r := row{purchaseResp: toResp(p), ClientID: p.UserID.String()}
		if u != nil {
			r.ClientName = u.Name
			r.ClientEmail = u.Email
		}
		out = append(out, r)
	}
	return httpx.OK(c, out)
}

// reconcilePerPage = ukuran page saat sweep registrar list. 100 = balance
// antara jumlah round-trip dan payload size (registrar-side default).
const reconcilePerPage = 100

// reconcileMaxPages = cap safety supaya kalau registrar salah return non-strictly
// decreasing page (misconfigured pagination), loop tidak infinite. 50 pages ×
// 100 = 5000 jobs — cukup untuk reseller besar; realistis MVP.
const reconcileMaxPages = 50

// Attach — dipanggil setelah user pilih template + slug supaya domain
// ter-link ke sites.id. Idempoten: sekali attached, tidak bisa detach dari
// endpoint ini (harus lewat delete site).
func (h *Handler) Attach(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	jobID := c.Params("job_id")
	var req struct {
		SiteID string `json:"site_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.SiteID == "" {
		return httpx.BadRequest(c, "site_id required")
	}
	siteID, err := uuid.Parse(req.SiteID)
	if err != nil {
		return httpx.BadRequest(c, "invalid site_id")
	}
	// Two-layer ownership check:
	//   1. Site milik user yang login — cegah user A attach domain-nya ke
	//      site_id user B (walaupun butuh tebak UUID, defence in depth).
	//   2. Purchase milik user yang login — di-enforce di repo.AttachSite via
	//      WHERE user_id di kolom domain_purchases.
	if h.sites != nil {
		if _, err := h.sites.GetOwned(c.Context(), siteID, cl.UserID); err != nil {
			if errors.Is(err, sites.ErrNotFound) {
				return httpx.NotFound(c, "site tidak ditemukan")
			}
			return httpx.Internal(c, "site lookup failed")
		}
	}
	if err := h.repo.AttachSite(c.Context(), jobID, cl.UserID, siteID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "job tidak ditemukan atau sudah di-attach")
		}
		return httpx.Internal(c, "attach failed")
	}
	return httpx.OK(c, fiber.Map{"ok": true})
}

// ------------- Admin: registrar webhook config -------------
//
// Admin endpoints — /api/v1/admin/* — proteksi via auth.RequireAdmin di router.

// AdminListPurchases — GET /api/v1/admin/registrar/purchases
//
// Paginated + filter (status, kind, q). Join dengan users → row include email
// + nama supaya admin bisa trace tanpa lookup manual.
//
// Query params:
//   status: pending_payment | pending_document | pending_provisioning | active | failed | expired
//   kind:   register | renew
//   q:      LIKE match domain OR user email
//   page, page_size, sort (default created_at DESC)
func (h *Handler) AdminListPurchases(c *fiber.Ctx) error {
	p := httpx.ParsePagination(c)
	f := AdminListFilter{
		Status: c.Query("status"),
		Kind:   c.Query("kind"),
		Like:   p.LikePattern(),
		Sort:   p.Sort,
		Limit:  p.PageSize,
		Offset: p.Offset(),
	}
	items, total, err := h.repo.AdminList(c.Context(), f)
	if err != nil {
		slog.Error("admin list purchases failed", "error", err)
		return httpx.Internal(c, "list failed")
	}
	// Transform ke response shape ringkas — jangan expose raw column tanpa filter.
	type row struct {
		JobID         string  `json:"job_id"`
		Domain        string  `json:"domain"`
		Status        string  `json:"status"`
		Kind          string  `json:"kind"`
		Reason        string  `json:"reason,omitempty"`
		Years         int     `json:"years"`
		PaymentMethod string  `json:"payment_method,omitempty"`
		ExpiresAt     string  `json:"expires_at,omitempty"`
		CreatedAt     string  `json:"created_at"`
		UpdatedAt     string  `json:"updated_at"`
		UserID        string  `json:"user_id"`
		UserEmail     string  `json:"user_email"`
		UserName      string  `json:"user_name"`
		SiteID        *string `json:"site_id,omitempty"`
	}
	out := make([]row, 0, len(items))
	for i := range items {
		it := &items[i]
		r := row{
			JobID:         it.RegistrarJobID,
			Domain:        it.Domain,
			Status:        it.Status,
			Kind:          it.Kind,
			Reason:        it.Reason,
			Years:         it.Years,
			PaymentMethod: it.PaymentMethod,
			CreatedAt:     it.CreatedAt.UTC().Format(time.RFC3339),
			UpdatedAt:     it.UpdatedAt.UTC().Format(time.RFC3339),
			UserID:        it.UserID.String(),
			UserEmail:     it.UserEmail,
			UserName:      it.UserName,
		}
		if it.ExpiresAt != nil {
			r.ExpiresAt = it.ExpiresAt.UTC().Format(time.RFC3339)
		}
		if it.SiteID != nil {
			s := it.SiteID.String()
			r.SiteID = &s
		}
		out = append(out, r)
	}
	return httpx.OK(c, httpx.MakePaginated(out, p, total))
}

// AdminListDomains — GET /api/v1/admin/domains
// Aggregate view lintas user — 1 row per FQDN dari tabel registered_domains.
// Beda dari AdminListPurchases yang transaction log.
//
// Filter: q (name/email), status, expiring_days, without_site.
// Pagination: page, page_size.
func (h *Handler) AdminListDomains(c *fiber.Ctx) error {
	p := httpx.ParsePagination(c)
	expiringDays, _ := strconv.Atoi(c.Query("expiring_days", "0"))
	f := AdminDomainFilter{
		Q:            strings.TrimSpace(c.Query("q")),
		Status:       strings.TrimSpace(c.Query("status")),
		ExpiringDays: expiringDays,
		WithoutSite:  c.Query("without_site") == "true",
		Page:         p.Page,
		PageSize:     p.PageSize,
	}
	items, total, err := h.repo.AdminListDomains(c.Context(), f)
	if err != nil {
		slog.Error("admin list domains failed", "error", err)
		return httpx.Internal(c, "list failed")
	}
	type row struct {
		Name           string  `json:"name"`
		Status         string  `json:"status"`
		ContactID      string  `json:"contact_id,omitempty"`
		ExpiresAt      string  `json:"expires_at,omitempty"`
		RegisteredAt   string  `json:"registered_at"`
		LastRenewedAt  string  `json:"last_renewed_at,omitempty"`
		SiteID         *string `json:"site_id,omitempty"`
		RegistrarJobID string  `json:"registrar_job_id,omitempty"`
		UserID         string  `json:"user_id"`
		UserEmail      string  `json:"user_email"`
		UserName       string  `json:"user_name"`
		PurchasedBy    *string `json:"purchased_by,omitempty"`
	}
	out := make([]row, 0, len(items))
	for _, it := range items {
		r := row{
			Name:           it.Name,
			Status:         it.Status,
			ContactID:      it.ContactID,
			RegisteredAt:   it.RegisteredAt.UTC().Format(time.RFC3339),
			RegistrarJobID: it.RegistrarJobID,
			UserID:         it.UserID.String(),
			UserEmail:      it.OwnerEmail,
			UserName:       it.OwnerName,
		}
		if it.ExpiresAt != nil {
			r.ExpiresAt = it.ExpiresAt.UTC().Format(time.RFC3339)
		}
		if it.LastRenewedAt != nil {
			r.LastRenewedAt = it.LastRenewedAt.UTC().Format(time.RFC3339)
		}
		if it.SiteID != nil {
			s := it.SiteID.String()
			r.SiteID = &s
		}
		if it.PurchasedBy != nil {
			s := it.PurchasedBy.String()
			r.PurchasedBy = &s
		}
		out = append(out, r)
	}
	return httpx.OK(c, httpx.MakePaginated(out, p, total))
}

// AdminDomainStats — GET /api/v1/admin/domains/stats
// Kartu ringkasan di /admin/domain. "Tanpa situs" = domain aktif yang belum
// pernah di-attach ke sites row — sinyal onboarding user mandek setelah bayar.
func (h *Handler) AdminDomainStats(c *fiber.Ctx) error {
	st, err := h.repo.AdminDomainStats(c.Context())
	if err != nil {
		slog.Error("admin domain stats failed", "error", err)
		return httpx.Internal(c, "stats failed")
	}
	return httpx.OK(c, fiber.Map{
		"total_active":        st.TotalActive,
		"active_without_site": st.ActiveWithoutSite,
	})
}

// AdminGetDomain — GET /api/v1/admin/domains/:name
// Detail 1 domain (aggregate registered_domains) tanpa ownership check.
// Include owner info via join users. Dipakai admin domain detail page.
func (h *Handler) AdminGetDomain(c *fiber.Ctx) error {
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}
	d, err := h.repo.GetDomainByNameAdmin(c.Context(), name)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan")
		}
		return httpx.Internal(c, "lookup failed")
	}
	// Enrich owner info.
	var ownerEmail, ownerName string
	if h.users != nil {
		if u, err := h.users.GetByID(c.Context(), d.UserID); err == nil {
			ownerEmail = u.Email
			ownerName = u.Name
		}
	}
	return httpx.OK(c, fiber.Map{
		"name":             d.Name,
		"user_id":          d.UserID.String(),
		"user_email":       ownerEmail,
		"user_name":        ownerName,
		"contact_id":       d.ContactID,
		"expires_at":       formatOptTime(d.ExpiresAt),
		"registered_at":    d.RegisteredAt.UTC().Format(time.RFC3339),
		"last_renewed_at":  formatOptTime(d.LastRenewedAt),
		"status":           d.Status,
		"registrar_job_id": d.RegistrarJobID,
		// DNS attach: generic field names. Admin UI (Step 13) reads these.
		"dns_attach_status":  d.DNSAttachStatus,
		"dns_attach_error":   d.DNSAttachError,
		"dns_attach_at":      formatOptTime(d.DNSAttachAt),
		"dns_zone_id":        d.DNSZoneID,
		"dns_provider":       d.DNSProvider,
		"dns_provider_config_id": uuidPtrString(d.DNSProviderConfigID),
	})
}

// AdminCloudflareRetry — POST /api/v1/admin/domains/:name/cloudflare-retry
//
// Re-run tryAttachToCloudflare untuk domain yang gagal atau belum di-attempt.
// Idempotent: kalau zone sudah ada di CF (duplicate error), tetap mark success.
// Route name retains "cloudflare" for URL back-compat; Step 9 switches internals
// to tryAttachToDNS which honors admin priority between CF/DNSCloud.
func (h *Handler) AdminCloudflareRetry(c *fiber.Ctx) error {
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}
	// Verify domain exist di registered_domains.
	d, err := h.repo.GetDomainByNameAdmin(c.Context(), name)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan di registered_domains")
		}
		return httpx.Internal(c, "lookup failed")
	}
	if h.cloudflare == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "cloudflare_disabled",
			"Cloudflare handler belum di-wire.")
	}
	// Reset status ke pending sebelum retry supaya UI visual jelas "sedang re-attempt".
	_ = h.repo.SetDomainDNSAttach(c.Context(), name, DNSAttachPending,
		"retry triggered manual by admin", d.DNSZoneID, d.DNSProvider, d.DNSProviderConfigID)

	// Trigger attach — synchronous (call provider API + registrar EPP). Persist
	// status otomatis via tryAttachToCloudflare.
	h.tryAttachToCloudflare(c.Context(), name)

	// Fetch fresh status untuk response.
	fresh, err := h.repo.GetDomainByNameAdmin(c.Context(), name)
	if err != nil {
		return httpx.OK(c, fiber.Map{
			"name":              name,
			"dns_attach_status": DNSAttachPending,
			"dns_attach_error":  "retry triggered, status update pending",
		})
	}
	return httpx.OK(c, fiber.Map{
		"name":                   fresh.Name,
		"dns_attach_status":      fresh.DNSAttachStatus,
		"dns_attach_error":       fresh.DNSAttachError,
		"dns_attach_at":          formatOptTime(fresh.DNSAttachAt),
		"dns_zone_id":            fresh.DNSZoneID,
		"dns_provider":           fresh.DNSProvider,
		"dns_provider_config_id": uuidPtrString(fresh.DNSProviderConfigID),
	})
}

// AdminWhois — GET /api/v1/admin/domains/:name/whois
// Passthrough ke registrar.Whois (public data, tidak butuh ownership).
func (h *Handler) AdminWhois(c *fiber.Ctx) error {
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled", "registrar client belum di-set")
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	w, err := h.registrar.Whois(c.Context(), name)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "registrar_error", err.Error())
	}
	if w == nil {
		return httpx.NotFound(c, "domain tidak terdaftar")
	}
	return httpx.OK(c, w)
}

// AdminGetNameservers — GET /api/v1/admin/domains/:name/nameservers
// Passthrough ke registrar tanpa ownership check.
func (h *Handler) AdminGetNameservers(c *fiber.Ctx) error {
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled", "registrar client belum di-set")
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	info, err := h.registrar.GetNameservers(c.Context(), name)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "registrar_error", err.Error())
	}
	return httpx.OK(c, info)
}

// dnsPrecheckAdmin — variant tanpa ownership check. Cek CF config + zone
// tersedia saja. Dipakai admin endpoints.
func (h *Handler) dnsPrecheckAdmin(c *fiber.Ctx, name string) (string, *cloudflare.Client, error) {
	if h.cloudflare == nil {
		return "", nil, httpx.Err(c, fiber.StatusServiceUnavailable, "cloudflare_disabled",
			"Fitur DNS belum aktif — admin perlu setup Cloudflare config.")
	}
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return "", nil, httpx.BadRequest(c, "name required")
	}
	cfg, err := h.cloudflare.GetDefault(c.Context())
	if err != nil {
		if errors.Is(err, cloudflare.ErrNotFound) {
			return "", nil, httpx.Err(c, fiber.StatusServiceUnavailable, "cloudflare_no_config",
				"Cloudflare default config belum di-set.")
		}
		return "", nil, httpx.Internal(c, "cloudflare config lookup failed")
	}
	client := cloudflare.NewClient(*cfg)
	zone, err := client.GetZoneByDomain(c.Context(), name)
	if err != nil {
		if errors.Is(err, cloudflare.ErrZoneNotFound) {
			return "", nil, httpx.Err(c, fiber.StatusNotFound, "zone_not_found",
				"Zone Cloudflare untuk domain ini belum tersedia.")
		}
		return "", nil, httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	return zone.ID, client, nil
}

// AdminListDNSRecords — GET /api/v1/admin/domains/:name/dns (read-only).
func (h *Handler) AdminListDNSRecords(c *fiber.Ctx) error {
	zoneID, client, errResp := h.dnsPrecheckAdmin(c, c.Params("name"))
	if client == nil {
		return errResp
	}
	records, err := client.ListDNSRecords(c.Context(), zoneID)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	return httpx.OK(c, fiber.Map{"records": records, "zone_id": zoneID})
}

// AdminCloudflareInfo — GET /api/v1/admin/domains/:name/cloudflare-info
// Sama seperti CloudflareInfo user-facing tapi bypass ownership.
func (h *Handler) AdminCloudflareInfo(c *fiber.Ctx) error {
	zoneID, client, errResp := h.dnsPrecheckAdmin(c, c.Params("name"))
	if client == nil {
		return errResp
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))

	zone, err := client.GetZoneByDomain(c.Context(), name)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	records, err := client.ListDNSRecords(c.Context(), zoneID)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "cloudflare_error", err.Error())
	}
	nsAtRegistrar := []string{}
	if h.registrar != nil {
		if info, err := h.registrar.GetNameservers(c.Context(), name); err == nil && info != nil {
			nsAtRegistrar = info.Nameservers
		}
	}
	apex := findRecord(records, "A", name)
	www := findRecord(records, "CNAME", "www."+name)
	pointsToPlatform := false
	if apex != nil {
		for _, ip := range h.platformIPs {
			if apex.Content == ip {
				pointsToPlatform = true
				break
			}
		}
	}
	nsSynced := nsListsEqual(zone.NameServers, nsAtRegistrar)
	return httpx.OK(c, fiber.Map{
		"zone": fiber.Map{
			"id":           zone.ID,
			"status":       zone.Status,
			"name_servers": zone.NameServers,
		},
		"records":                  records,
		"nameservers_at_registrar": nsAtRegistrar,
		"platform_ips":             h.platformIPs,
		"checks": fiber.Map{
			"zone_active":              zone.Status == "active",
			"ns_synced":                nsSynced,
			"apex_present":             apex != nil,
			"apex_points_to_platform":  pointsToPlatform,
			"www_present":              www != nil,
		},
	})
}

// dnscloudInfoFor builds the DNSCloud health response for a given domain row.
// Called by both admin (no ownership check) and user (ownership-checked)
// handlers so the diagnostic shape stays identical.
func (h *Handler) dnscloudInfoFor(c *fiber.Ctx, d *Domain) error {
	if h.dnsProvidersRepo == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "dns_providers_disabled",
			"DNS providers repo belum di-wire di main.go")
	}
	if d.DNSProvider != "dnscloud" {
		return httpx.Err(c, fiber.StatusBadRequest, "wrong_provider",
			"Domain ini pakai provider '"+d.DNSProvider+"', bukan dnscloud. Gunakan /cloudflare-info.")
	}
	if d.DNSProviderConfigID == nil {
		return httpx.Err(c, fiber.StatusConflict, "missing_config_id",
			"Domain tidak punya dns_provider_config_id — kemungkinan attach belum pernah sukses.")
	}
	cfg, err := h.dnsProvidersRepo.GetByID(c.Context(), *d.DNSProviderConfigID)
	if err != nil {
		return httpx.NotFound(c, "DNS provider config tidak ditemukan: "+err.Error())
	}
	if cfg.Kind != "dnscloud" {
		return httpx.Err(c, fiber.StatusInternalServerError, "config_kind_mismatch",
			"Row domain claim 'dnscloud' tapi config_id milik '"+cfg.Kind+"' — data inconsistent.")
	}
	if d.DNSZoneID == "" {
		return httpx.Err(c, fiber.StatusConflict, "missing_zone_id",
			"Domain tidak punya dns_zone_id — attach belum pernah selesai sampai zone creation.")
	}

	dcClient := dnscloud.NewClient(dnscloud.Config{APIToken: cfg.APIToken})
	zone, err := dcClient.GetZoneDetail(c.Context(), d.DNSZoneID)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadGateway, "dnscloud_error",
			"Gagal fetch zone: "+err.Error())
	}
	// DNSSEC optional — swallow nil (zone belum pernah aktif DNSSEC).
	dnssec, _ := dcClient.GetDNSSECStatus(c.Context(), d.DNSZoneID)

	nsAtRegistrar := []string{}
	if h.registrar != nil {
		if info, rErr := h.registrar.GetNameservers(c.Context(), d.Name); rErr == nil && info != nil {
			nsAtRegistrar = info.Nameservers
		}
	}
	nsSynced := nsListsEqual(zone.Nameservers, nsAtRegistrar)

	return httpx.OK(c, fiber.Map{
		"zone": fiber.Map{
			"id":             zone.Zone.ID,
			"name":           zone.Zone.Name,
			"status":         zone.Zone.Status,
			"version":        zone.Zone.Version,
			"soa_serial":     zone.Zone.SOASerial,
			"dnssec_enabled": zone.Zone.DNSSECEnabled,
			"nameservers":    zone.Nameservers,
			"plan_name":      zone.Zone.PlanName,
		},
		"propagation":              zone.Propagation,
		"dnssec":                   dnssec,
		"nameservers_at_registrar": nsAtRegistrar,
		"checks": fiber.Map{
			"zone_active": zone.Zone.Status == "active",
			"ns_synced":   nsSynced,
		},
	})
}

// AdminDNSCloudInfo — GET /api/v1/admin/domains/:name/dnscloud-info
// Admin diagnostic view (no ownership check).
func (h *Handler) AdminDNSCloudInfo(c *fiber.Ctx) error {
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}
	d, err := h.repo.GetDomainByNameAdmin(c.Context(), name)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan")
		}
		return httpx.Internal(c, "lookup failed: "+err.Error())
	}
	return h.dnscloudInfoFor(c, d)
}

// DNSCloudInfo — GET /api/v1/domains/:name/dnscloud-info
// User-facing health view with ownership check. Inclusive ke on-behalf-of
// (purchased_by) sejajar dengan GetNameservers/Whois pattern.
func (h *Handler) DNSCloudInfo(c *fiber.Ctx) error {
	cl := auth.ClaimsFrom(c)
	// Guard: cl bisa nil kalau auth middleware gagal set claims (edge case:
	// expired token di refresh race). Tanpa guard, cl.UserID → nil pointer
	// deref → panic → Fiber recover envelope "runtime error". Return 401
	// clean supaya UI handle properly.
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return httpx.BadRequest(c, "name required")
	}
	d, err := h.repo.GetDomainByName(c.Context(), name, cl.UserID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan atau bukan milik Anda")
		}
		return httpx.Internal(c, "lookup failed: "+err.Error())
	}
	return h.dnscloudInfoFor(c, d)
}

// AdminSwitchProvider — POST /api/v1/admin/domains/:name/switch-provider
// Body: { target_provider: "cloudflare" | "dnscloud" | "external" }
//
// Admin tool untuk pindah zone ownership ke provider lain. Flow:
//
//   1. "cloudflare" / "dnscloud":
//      - Resolve provider via factory (explicit kind, bukan priority)
//      - FindZoneByDomain → kalau ada, reuse. Kalau tidak, CreateZone
//      - Cleanup CNAME @ + CNAME www (hindari conflict RFC 1912)
//      - Upsert A @ + A www → PLATFORM_IPS[0] (proxied)
//      - EnableProxy @ + www (meaningful di DNSCloud, no-op di CF)
//      - Push NS ke registrar via UpdateNameservers
//      - Persist registered_domains.dns_* ke target baru
//      - Best-effort delete zone lama di provider sebelumnya
//
//   2. "external":
//      - Clear dns_zone_id + dns_provider_config_id
//      - Set dns_provider='external', status='skipped' dengan note "Managed externally"
//      - Best-effort delete zone lama
//      - Platform STOP manage zone (health panel + reconciler skip)
//
// Side effects + risk:
//   - NS di registrar DI-UPDATE untuk CF/DNSCloud target. Visitor domain
//     bisa kena brief downtime selama propagasi NS parent zone.
//   - Zone lama di provider sebelumnya DI-DELETE best-effort. Kalau delete
//     gagal (CF/DNSCloud API down), zone orphan di provider lama — orphan
//     reconciler (future work) atau admin manual yang handle.
func (h *Handler) AdminSwitchProvider(c *fiber.Ctx) error {
	name, target, errResp := h.parseSwitchRequest(c)
	if errResp != nil {
		return errResp
	}
	d, err := h.repo.GetDomainByNameAdmin(c.Context(), name)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan")
		}
		return httpx.Internal(c, "lookup failed: "+err.Error())
	}
	return h.switchProviderFor(c, d, target)
}

// UserSwitchProvider — POST /api/v1/domains/:name/switch-provider
// User-facing variant dengan ownership check (inclusive on-behalf-of via
// purchased_by). Sering dipakai user untuk sinkron state DB setelah mereka
// flip NS manual di PANDI panel.
func (h *Handler) UserSwitchProvider(c *fiber.Ctx) error {
	name, target, errResp := h.parseSwitchRequest(c)
	if errResp != nil {
		return errResp
	}
	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	d, err := h.repo.GetDomainByName(c.Context(), name, cl.UserID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "domain tidak ditemukan atau bukan milik Anda")
		}
		return httpx.Internal(c, "lookup failed: "+err.Error())
	}
	return h.switchProviderFor(c, d, target)
}

// parseSwitchRequest — shared parser: ambil domain name + target_provider,
// validate. Return name + target atau errResp yang sudah ter-write.
func (h *Handler) parseSwitchRequest(c *fiber.Ctx) (string, string, error) {
	name := strings.ToLower(strings.TrimSpace(c.Params("name")))
	if name == "" {
		return "", "", httpx.BadRequest(c, "name required")
	}
	var req struct {
		TargetProvider string `json:"target_provider"`
	}
	if err := c.BodyParser(&req); err != nil {
		return "", "", httpx.BadRequest(c, "invalid json")
	}
	target := strings.ToLower(strings.TrimSpace(req.TargetProvider))
	switch target {
	case "cloudflare", "dnscloud", "external":
	default:
		return "", "", httpx.BadRequest(c, "target_provider must be 'cloudflare', 'dnscloud', or 'external'")
	}
	return name, target, nil
}

// switchProviderFor — shared body untuk admin + user switch. Caller sudah
// resolve Domain row (ownership-checked di user path, bypass di admin path).
func (h *Handler) switchProviderFor(c *fiber.Ctx, d *Domain, target string) error {
	name := d.Name
	oldProvider := d.DNSProvider
	oldZoneID := d.DNSZoneID
	oldConfigID := d.DNSProviderConfigID

	// --- External: platform stop manage zone -------------------------------
	if target == "external" {
		if err := h.repo.SetDomainProviderSwitch(c.Context(), name,
			"external", "", nil,
			DNSAttachSkipped, "Managed externally by user — platform tidak kelola zone."); err != nil {
			return httpx.Internal(c, "persist switch failed: "+err.Error())
		}
		h.cleanupOldZoneBestEffort(c.Context(), oldProvider, oldConfigID, oldZoneID, name)
		return httpx.OK(c, fiber.Map{
			"ok":           true,
			"old_provider": oldProvider,
			"old_zone_id":  oldZoneID,
			"new_provider": "external",
			"note":         "Platform tidak lagi kelola zone. User manage NS + DNS di provider eksternal.",
		})
	}

	// --- Cloudflare / DNSCloud: full re-attach ke target -------------------
	if h.providerFactory == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "factory_disabled",
			"DNS provider factory belum di-wire.")
	}
	if h.registrar == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "registrar_disabled",
			"Registrar client belum di-wire.")
	}

	prov, newConfigIDStr, err := h.providerFactory(c.Context(), dnsprovider.Choice{
		Explicit: dnsprovider.Kind(target),
	})
	if err != nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "no_active_config",
			"Tidak ada config aktif untuk provider '"+target+"'. Setup di /admin/dns-providers dulu.")
	}
	newConfigUUID, _ := uuid.Parse(newConfigIDStr)

	// Find or create zone at target.
	zone, err := prov.CreateZone(c.Context(), name)
	if err != nil {
		if errors.Is(err, dnsprovider.ErrZoneAlreadyExists) {
			existing, lErr := prov.FindZoneByDomain(c.Context(), name)
			if lErr != nil || existing == nil {
				return httpx.Err(c, fiber.StatusBadGateway, "zone_exists_lookup_failed",
					"Zone ada di provider tapi lookup gagal: "+err.Error())
			}
			zone = existing
		} else {
			return httpx.Err(c, fiber.StatusBadGateway, "create_zone_failed",
				"Gagal create zone di "+target+": "+err.Error())
		}
	}

	// Cleanup conflicting CNAMEs before UpsertRecord A (RFC 1912).
	_ = prov.DeleteRecord(c.Context(), zone.ID, "CNAME", "@")
	_ = prov.DeleteRecord(c.Context(), zone.ID, "CNAME", "www")

	// Setup A records + enable proxy.
	var warnings []string
	if len(h.platformIPs) > 0 {
		ip := h.platformIPs[0]
		if err := prov.UpsertRecord(c.Context(), zone.ID, dnsprovider.Record{
			Type: "A", Name: "@", Content: ip, Proxied: true,
		}); err != nil {
			warnings = append(warnings, "A @ failed: "+err.Error())
		}
		if err := prov.UpsertRecord(c.Context(), zone.ID, dnsprovider.Record{
			Type: "A", Name: "www", Content: ip, Proxied: true,
		}); err != nil {
			warnings = append(warnings, "A www failed: "+err.Error())
		}
		_ = prov.EnableProxy(c.Context(), zone.ID, "@")
		_ = prov.EnableProxy(c.Context(), zone.ID, "www")
	} else {
		warnings = append(warnings, "PLATFORM_IPS kosong, A records tidak di-setup")
	}

	// Push NS to registrar. Kalau NS di registrar sudah match (user flip
	// manual sebelumnya), UpdateNameservers no-op. Kalau beda, update.
	if _, err := h.registrar.UpdateNameservers(c.Context(), name, zone.Nameservers); err != nil {
		// NS push gagal — tapi zone + records sudah terbuat. Persist state
		// sebagai failed_ns, admin bisa manual update NS di PANDI atau retry.
		_ = h.repo.SetDomainProviderSwitch(c.Context(), name,
			target, zone.ID, &newConfigUUID,
			DNSAttachFailed, "Zone pindah OK, tapi push NS ke registrar gagal: "+err.Error())
		return httpx.Err(c, fiber.StatusBadGateway, "ns_push_failed",
			"Zone sudah terbuat di "+target+" tapi push NS ke PANDI gagal: "+err.Error())
	}

	// Persist new state.
	successMsg := ""
	if len(warnings) > 0 {
		successMsg = "warning: " + strings.Join(warnings, "; ")
	}
	if err := h.repo.SetDomainProviderSwitch(c.Context(), name,
		target, zone.ID, &newConfigUUID,
		DNSAttachSuccess, successMsg); err != nil {
		return httpx.Internal(c, "persist switch failed: "+err.Error())
	}

	// Cleanup old zone at previous provider (best-effort).
	h.cleanupOldZoneBestEffort(c.Context(), oldProvider, oldConfigID, oldZoneID, name)

	return httpx.OK(c, fiber.Map{
		"ok":              true,
		"old_provider":    oldProvider,
		"old_zone_id":     oldZoneID,
		"new_provider":    target,
		"new_zone_id":     zone.ID,
		"new_nameservers": zone.Nameservers,
		"warnings":        warnings,
	})
}

// cleanupOldZoneBestEffort hapus zone di provider lama via sticky config_id.
// Dipanggil setelah switch sukses supaya tidak leak zone di akun provider
// yang tidak lagi dipakai domain ini. Semua error di-log, tidak fatal.
func (h *Handler) cleanupOldZoneBestEffort(ctx context.Context, oldKind string, oldConfigID *uuid.UUID, oldZoneID, name string) {
	if oldZoneID == "" || oldConfigID == nil || oldKind == "" || oldKind == "external" {
		return
	}
	if h.providerFactory == nil {
		return
	}
	prov, _, err := h.providerFactory(ctx, dnsprovider.Choice{StickyConfigID: oldConfigID.String()})
	if err != nil {
		slog.Warn("switch provider: cleanup old provider resolve failed",
			"domain", name, "old_provider", oldKind, "old_config_id", oldConfigID.String(), "error", err)
		return
	}
	if err := prov.DeleteZone(ctx, oldZoneID); err != nil {
		slog.Warn("switch provider: cleanup old zone delete failed",
			"domain", name, "old_provider", oldKind, "old_zone_id", oldZoneID, "error", err)
		return
	}
	slog.Info("switch provider: old zone cleaned up",
		"domain", name, "old_provider", oldKind, "old_zone_id", oldZoneID)
}

// formatOptTime — helper untuk nullable *time.Time → RFC3339 atau kosong.
func formatOptTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// uuidPtrString renders a nullable UUID as empty string on nil, canonical
// string form otherwise. Keeps JSON responses stable instead of emitting
// `null` for missing provider_config_id on legacy rows.
func uuidPtrString(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

// tryAttachToCloudflare = best-effort auto-attach domain baru ke Cloudflare:
//  1. Ambil config CF default (skip kalau belum di-setup admin).
//  2. Create zone di CF → dapat NS assignment + zone_id.
//  3. Create A record `@` → PLATFORM_IPS[0] (proxied=true, lewat CF edge).
//  4. Create CNAME `www` → root domain (proxied=true).
//  5. Push NS itu ke registrar via UpdateNameservers.
//
// Semua error di-log tapi TIDAK propagate — domain sudah live di registry,
// CF attach hanya optimization. DNS record failure (mis. duplicate) di-treat
// warn tapi flow lanjut (zone tetap valid, admin bisa fix DNS manual).
//
// Kalau PLATFORM_IPS kosong, skip create DNS records (zone tetap dibuat +
// NS di-push, tapi user harus setup DNS record manual di CF dashboard).
// tryAttachToCloudflare — thin wrapper retained for compatibility with the
// existing AdminCloudflareRetry route path. Delegates to tryAttachToDNS which
// honors admin priority + user choice.
func (h *Handler) tryAttachToCloudflare(ctx context.Context, domain string) {
	h.tryAttachToDNS(ctx, domain)
}

// tryAttachToDNS = best-effort auto-attach domain baru ke DNS provider terpilih:
//  1. Lookup user's provider choice (purchase.dns_provider_choice) + resolve
//     via factory (fall back to legacy CF repo kalau factory tidak di-set).
//  2. CreateZone di provider → dapat NS pair + zone_id.
//  3. UpsertRecord A `@` → PLATFORM_IPS[0], CNAME `www` → domain (proxied).
//  4. EnableProxy per hostname (no-op di CF, pakai PUT /proxy di DNSCloud).
//  5. Push NS itu ke registrar via UpdateNameservers.
//
// Semua error di-log tapi TIDAK propagate — domain sudah live di registry,
// attach hanya optimization. Admin bisa retry via UI kalau failed.
func (h *Handler) tryAttachToDNS(ctx context.Context, domain string) {
	if h.registrar == nil || domain == "" {
		return
	}
	// Lookup latest register purchase to read dns_provider_choice.
	var userChoice string
	if p, err := h.repo.GetLatestRegisterByDomainAny(ctx, domain); err == nil && p != nil && p.DNSProviderChoice != nil {
		userChoice = *p.DNSProviderChoice
	}

	persistStatus := func(status, errMsg, zoneID, providerKind string, configID *uuid.UUID) {
		pk := providerKind
		if pk == "" {
			pk = "cloudflare"
		}
		if err := h.repo.SetDomainDNSAttach(ctx, domain, status, errMsg, zoneID, pk, configID); err != nil && !errors.Is(err, ErrNotFound) {
			slog.Warn("dns attach: persist status failed (non-fatal)",
				"error", err, "domain", domain, "status", status)
		}
	}

	// Resolve provider via factory. Fail-honest: if factory unset OR no active
	// config, mark skipped so admin sees it's a config issue, not a system bug.
	if h.providerFactory == nil {
		persistStatus(DNSAttachSkipped, "dns provider factory belum di-wire di /admin/dns-providers", "", "", nil)
		metrics.Default.CounterInc("dns_attach_total",
			"Auto-attach ke DNS provider per outcome",
			map[string]string{"result": "skipped_no_factory", "provider": "none"},
		)
		return
	}
	prov, configIDStr, err := h.providerFactory(ctx, dnsprovider.Choice{Explicit: dnsprovider.Kind(userChoice)})
	if err != nil {
		slog.Warn("dns attach: factory resolve failed", "error", err, "domain", domain, "choice", userChoice)
		persistStatus(DNSAttachSkipped, "dns provider config belum di-set: "+err.Error(), "", "", nil)
		metrics.Default.CounterInc("dns_attach_total",
			"Auto-attach ke DNS provider per outcome",
			map[string]string{"result": "skipped_no_config", "provider": "none"},
		)
		return
	}
	configUUID, _ := uuid.Parse(configIDStr)
	configIDPtr := &configUUID
	providerKind := string(prov.Kind())
	logAttrs := []any{"domain", domain, "provider", providerKind, "config_id", configIDStr}

	zone, err := prov.CreateZone(ctx, domain)
	if err != nil {
		// Idempotent retry: zone sudah ada (dari attempt sebelumnya yang NS
		// push-nya gagal) → lookup existing zone + lanjut flow. Common pada
		// scenario "NS push gagal karena EPP host object" di PANDI.
		if errors.Is(err, dnsprovider.ErrZoneAlreadyExists) {
			existing, lErr := prov.FindZoneByDomain(ctx, domain)
			if lErr != nil || existing == nil {
				slog.Warn("dns attach: zone exists but lookup failed",
					append(logAttrs, "lookup_error", lErr, "create_error", err)...)
				persistStatus(DNSAttachFailed,
					"zone sudah ada tapi gagal fetch: "+err.Error(),
					"", providerKind, configIDPtr)
				metrics.Default.CounterInc("dns_attach_total",
					"Auto-attach ke DNS provider per outcome",
					map[string]string{"result": "zone_exists_lookup_failed", "provider": providerKind},
				)
				return
			}
			zone = existing
			slog.Info("dns attach: zone exists, reusing", append(logAttrs, "zone_id", zone.ID)...)
			metrics.Default.CounterInc("dns_attach_total",
				"Auto-attach ke DNS provider per outcome",
				map[string]string{"result": "zone_reused", "provider": providerKind},
			)
			// fall through ke UpsertRecord + UpdateNameservers
		} else {
			slog.Warn("dns attach: create zone failed", append(logAttrs, "error", err)...)
			persistStatus(DNSAttachFailed, "create zone: "+err.Error(), "", providerKind, configIDPtr)
			metrics.Default.CounterInc("dns_attach_total",
				"Auto-attach ke DNS provider per outcome",
				map[string]string{"result": "zone_failed", "provider": providerKind},
			)
			return
		}
	}

	// -------- DNS records --------
	var dnsWarnings []string
	if len(h.platformIPs) > 0 {
		platformIP := h.platformIPs[0]
		// Cleanup pass: hapus stale CNAME di @ dan www sebelum PUT A.
		// Diperlukan untuk 2 kasus:
		//   1. Retry attach dari pattern lama yang pakai CNAME www → domain.
		//      PUT A www tolak kalau CNAME masih ada (RFC 1912).
		//   2. Provider yang auto-park zone baru dengan CNAME ke parking page.
		// Idempotent — DeleteRecord return nil kalau RRset tidak ada.
		if err := prov.DeleteRecord(ctx, zone.ID, "CNAME", "@"); err != nil {
			slog.Warn("dns attach: cleanup CNAME @ failed (non-fatal)",
				append(logAttrs, "error", err)...)
		}
		if err := prov.DeleteRecord(ctx, zone.ID, "CNAME", "www"); err != nil {
			slog.Warn("dns attach: cleanup CNAME www failed (non-fatal)",
				append(logAttrs, "error", err)...)
		}
		// Pattern A @ + A www (bukan CNAME www → domain):
		//   - CNAME tidak boleh coexist dengan record type lain di nama yang
		//     sama (RFC 1912). Beberapa provider (DNSCloud) auto-create
		//     parking A record di www saat zone baru dibuat; CNAME www kita
		//     langsung konflik → "CNAME_CONFLICT: www sudah memiliki record
		//     bertipe lain".
		//   - A www → platformIP: UpsertRecord REPLACE existing RRset tipe A
		//     (termasuk parking IP), zero-conflict, hasil behavior sama
		//     (visitor hit www → platform via same IP).
		if err := prov.UpsertRecord(ctx, zone.ID, dnsprovider.Record{
			Type: "A", Name: "@", Content: platformIP, Proxied: true,
		}); err != nil {
			slog.Warn("dns attach: create A @ failed",
				append(logAttrs, "content", platformIP, "error", err)...)
			dnsWarnings = append(dnsWarnings, "A @ failed: "+err.Error())
		}
		if err := prov.UpsertRecord(ctx, zone.ID, dnsprovider.Record{
			Type: "A", Name: "www", Content: platformIP, Proxied: true,
		}); err != nil {
			slog.Warn("dns attach: create A www failed",
				append(logAttrs, "content", platformIP, "error", err)...)
			dnsWarnings = append(dnsWarnings, "A www failed: "+err.Error())
		}
		// EnableProxy — no-op di CF (handled per-record via Proxied flag),
		// meaningful di DNSCloud (separate per-hostname toggle).
		if err := prov.EnableProxy(ctx, zone.ID, "@"); err != nil {
			slog.Warn("dns attach: enable proxy @ failed (non-fatal)",
				append(logAttrs, "error", err)...)
		}
		if err := prov.EnableProxy(ctx, zone.ID, "www"); err != nil {
			slog.Warn("dns attach: enable proxy www failed (non-fatal)",
				append(logAttrs, "error", err)...)
		}
	} else {
		slog.Warn("dns attach: PLATFORM_IPS kosong, skip create DNS records",
			append(logAttrs, "zone_id", zone.ID)...)
		dnsWarnings = append(dnsWarnings, "PLATFORM_IPS kosong, DNS records tidak dibuat")
	}

	// -------- Push NS ke registrar --------
	if _, err := h.registrar.UpdateNameservers(ctx, domain, zone.Nameservers); err != nil {
		slog.Warn("dns attach: update NS at registrar failed",
			append(logAttrs, "ns", zone.Nameservers, "error", err)...)
		persistStatus(DNSAttachFailed,
			"zone created tapi push NS ke registrar gagal: "+err.Error(), zone.ID, providerKind, configIDPtr)
		metrics.Default.CounterInc("dns_attach_total",
			"Auto-attach ke DNS provider per outcome",
			map[string]string{"result": "ns_push_failed", "provider": providerKind},
		)
		return
	}

	successMsg := ""
	if len(dnsWarnings) > 0 {
		successMsg = "warning: " + strings.Join(dnsWarnings, "; ")
	}
	persistStatus(DNSAttachSuccess, successMsg, zone.ID, providerKind, configIDPtr)
	slog.Info("dns attach: success",
		append(logAttrs, "zone_id", zone.ID, "ns", zone.Nameservers)...)
	metrics.Default.CounterInc("dns_attach_total",
		"Auto-attach ke DNS provider per outcome",
		map[string]string{"result": "success", "provider": providerKind},
	)
}

// ------------- helpers -------------

func toResp(p *Purchase) purchaseResp {
	out := purchaseResp{
		JobID:         p.RegistrarJobID,
		Domain:        p.Domain,
		Status:        p.Status,
		Kind:          p.Kind,
		Reason:        p.Reason,
		PaymentURL:    p.PaymentURL,
		PaymentMethod: p.PaymentMethod,
		Years:         p.Years,
		UpdatedAt:     p.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if p.ExpiresAt != nil {
		out.ExpiresAt = p.ExpiresAt.UTC().Format(time.RFC3339)
	}
	if p.SiteID != nil {
		s := p.SiteID.String()
		out.SiteID = &s
	}
	return out
}

func missingProfileFields(u *auth.User) []string {
	var missing []string
	check := func(label, v string) {
		if strings.TrimSpace(v) == "" {
			missing = append(missing, label)
		}
	}
	check("nama", u.Name)
	check("nomor HP", u.PhoneNumber)
	check("alamat", u.Address)
	check("kota", u.City)
	check("kode pos", u.PostalCode)
	return missing
}

// silence unused imports if handler shrinks
var _ = io.Discard
var _ = bytes.NewReader

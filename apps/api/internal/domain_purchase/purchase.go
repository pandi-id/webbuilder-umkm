// purchase.go — Phase A checkout untuk flow 2-phase self-sufficient.
//
// 2-phase self-sufficient checkout:
//   - Price lookup dari platform_prices lokal (bukan trust registrar response)
//   - Zone active check dari zones lokal (operator control)
//   - Invoice dibuat lokal via invoices.Service (dengan PPN via settings)
//   - Payment charge via paymentgw lokal (Midtrans/manual_bank/dsb.)
//   - Return payment_url + invoice_id + job_id ke frontend
//
// Phase B (EPP execute) di-trigger otomatis oleh paymentwh webhook via
// ExecuteAfterPayment callback (sudah in-place).
//
// Scope:
//   - Register + renew (renew.go pola sama)
//   - Payment method: gateway (midtrans/paylabs) + manual (manual_bank) + wallet (deposit_wallet)
//   - On-behalf-of: reseller/agent beli untuk klien (validated via assignments)
//   - Promo: validate + redeem via promos.Service (kode di request payload)

package domain_purchase

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/webbuilder/api/internal/audit"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/metrics"
)

const metricPurchasesCreated = "domain_purchase_created_total"

// purchaseReq — payload untuk checkout 2-phase.
type purchaseReq struct {
	Domain        string `json:"domain"`
	Years         int    `json:"years"`
	PaymentMethod string `json:"payment_method"` // "midtrans" | "paylabs" | "manual_bank" | "deposit_wallet"
	ReturnURL     string `json:"return_url,omitempty"`
	// OnBehalfOfUserID — kalau di-set, reseller/agent beli domain untuk client.
	// Invoice.user_id = client_id, invoice.purchased_by = caller. Contact object
	// diisi dari profil client (bukan caller). Kosong = self-purchase.
	OnBehalfOfUserID string `json:"on_behalf_of_user_id,omitempty"`
	// DocumentIDs — dokumen library (documents_local UUIDs) yang di-pre-attach
	// ke purchase. Tidak ada status pending_document di flow ini (dokumen
	// review out-of-band), jadi ini murni audit trail + persiapan manual review.
	DocumentIDs []string `json:"document_ids,omitempty"`
	// PromoCode — opsional. Validate via promos service; kalau invalid,
	// return 400 (bukan silent-fallback — user pasti mau tau code-nya salah).
	PromoCode string `json:"promo_code,omitempty"`
	// DNSProviderChoice — opsional override user untuk DNS backend. Kosong =
	// ikut admin priority. "cloudflare"/"dnscloud" = explicit. Dipersist ke
	// domain_purchases.dns_provider_choice, dibaca oleh tryAttachToDNS saat
	// EPP CREATE sukses.
	DNSProviderChoice string `json:"dns_provider_choice,omitempty"`
}

// purchaseCreatedResp — response.
type purchaseCreatedResp struct {
	JobID        string `json:"job_id"` // = invoice_id string (single source of truth)
	InvoiceID    string `json:"invoice_id"`
	Domain       string `json:"domain"`
	Status       string `json:"status"`                 // "pending_payment"
	PaymentURL   string `json:"payment_url,omitempty"`  // gateway redirect (kosong untuk manual_bank)
	Instructions string `json:"instructions,omitempty"` // manual_bank markdown
	Total        int64  `json:"total"`                  // IDR minor unit — total setelah PPN
	Currency     string `json:"currency"`
	DueAt        string `json:"due_at"` // RFC3339
}

// Purchase — Phase A checkout. Bikin invoice + payment charge lokal;
// EPP execute lewat api-registry di ExecuteAfterPayment callback.
//
// POST /api/v1/domains/purchase
// Body: purchaseReq
// Header: Idempotency-Key (wajib untuk cegah double-charge).
func (h *Handler) Purchase(c *fiber.Ctx) error {
	// Dependency check — kalau ada yang belum wired, kasih hint clear.
	if h.pricingRepo == nil || h.invoicesSvc == nil || h.gwRegistry == nil {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "purchase_not_ready",
			"Fitur checkout 2-phase belum aktif — dependencies pricing/invoices/gateway belum wired.")
	}
	if h.registrar == nil || !h.registrar.UsesAPIRegistry() {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "api_registry_required",
			"Fitur checkout 2-phase butuh API_REGISTRY_URL di-set (EPP execute via api-registry).")
	}

	cl := auth.ClaimsFrom(c)
	if cl == nil {
		return httpx.Unauthorized(c, "no claims")
	}
	var req purchaseReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.Domain = strings.ToLower(strings.TrimSpace(req.Domain))
	if req.Domain == "" || !strings.Contains(req.Domain, ".") {
		return httpx.BadRequest(c, "domain full FQDN wajib (mis. myshop.id)")
	}
	// Blokir domain premium .id yang punya SLD terlalu pendek — reseller
	// catalog hanya satu tier harga per TLD, jadi domain premium harus
	// di-flow terpisah (manual oleh admin). Pesan error user-facing eksplisit
	// supaya user tidak merasa dikerjain.
	if err := validateDomainLength(req.Domain); err != nil {
		return httpx.Err(c, fiber.StatusBadRequest, "domain_premium_blocked", err.Error())
	}
	if req.Years < 1 || req.Years > 10 {
		return httpx.BadRequest(c, "years harus 1-10")
	}
	req.PaymentMethod = strings.TrimSpace(req.PaymentMethod)
	if req.PaymentMethod == "" {
		return httpx.BadRequest(c, "payment_method wajib")
	}

	// Idempotency key wajib — cegah double-charge saat browser retry.
	idem := strings.TrimSpace(c.Get("Idempotency-Key"))
	if idem == "" {
		return httpx.Err(c, fiber.StatusBadRequest, "idempotency_key_required",
			"Header Idempotency-Key wajib untuk cegah double-charge.")
	}

	// Fetch caller profile — untuk contact + gateway customer info.
	caller, err := h.users.GetByID(c.Context(), cl.UserID)
	if err != nil {
		return httpx.Internal(c, "user lookup failed")
	}

	// Default: self-purchase. Owner = caller, purchased_by = NULL.
	owner := caller
	var purchasedBy *uuid.UUID

	// On-behalf-of branch — reseller/agent beli untuk klien yang mereka kelola.
	if strings.TrimSpace(req.OnBehalfOfUserID) != "" {
		if !auth.CanRegisterForClient(caller) {
			return httpx.Forbidden(c, "hanya reseller/agent aktif yang boleh beli untuk klien")
		}
		if h.assignments == nil {
			return httpx.Err(c, fiber.StatusServiceUnavailable, "assignments_disabled",
				"Fitur beli atas nama klien belum dikonfigurasi di server.")
		}
		clientID, err := uuid.Parse(req.OnBehalfOfUserID)
		if err != nil {
			return httpx.BadRequest(c, "on_behalf_of_user_id bukan UUID valid")
		}
		if clientID == caller.ID {
			return httpx.BadRequest(c, "on_behalf_of_user_id tidak boleh sama dengan caller")
		}
		if err := h.assignments.HasActiveAssignment(c.Context(), caller.ID, clientID); err != nil {
			return httpx.Forbidden(c, "Anda tidak mengelola klien ini")
		}
		clientUser, err := h.users.GetByID(c.Context(), clientID)
		if err != nil {
			return httpx.Internal(c, "client lookup failed")
		}
		owner = clientUser
		id := caller.ID
		purchasedBy = &id
	}

	// Wallet payment restriction: reseller/agent-only (wallet konsep khusus
	// reseller). Client biasa tidak punya wallet.
	if req.PaymentMethod == "deposit_wallet" && !auth.IsResellerLike(caller.Role) {
		return httpx.Forbidden(c, "payment_method 'deposit_wallet' hanya untuk reseller/agent")
	}
	// Agent pakai wallet reseller induk — bukan wallet sendiri. Agent tidak
	// diberikan mekanisme top-up terpisah supaya akunting terpusat di reseller.
	if req.PaymentMethod == "deposit_wallet" && caller.Role == auth.RoleAgent {
		if caller.ParentResellerID == nil {
			return httpx.Err(c, fiber.StatusBadRequest, "agent_orphan",
				"Akun agent tidak terhubung ke reseller. Hubungi admin.")
		}
	}

	if missing := missingProfileFields(owner); len(missing) > 0 {
		who := "profil Anda"
		path := "/settings/profile"
		if purchasedBy != nil {
			who = "profil klien"
			path = "/reseller/clients"
		}
		return httpx.Err(c, fiber.StatusBadRequest, "profile_incomplete",
			"Lengkapi "+who+" dulu di "+path+" — field kosong: "+strings.Join(missing, ", "))
	}

	// Extract TLD supaya bisa lookup zone + price.
	tld := extractTLD(req.Domain)
	if tld == "" {
		return httpx.BadRequest(c, "domain tidak punya TLD valid")
	}

	// Zone active check — kalau zones repo di-set, enforce.
	if h.zonesRepo != nil {
		z, err := h.zonesRepo.GetByTLD(c.Context(), tld)
		if err != nil {
			return httpx.Err(c, fiber.StatusBadRequest, "zone_not_supported",
				fmt.Sprintf("TLD .%s tidak didukung platform", tld))
		}
		if !z.Active {
			return httpx.Err(c, fiber.StatusBadRequest, "zone_disabled",
				fmt.Sprintf("TLD .%s sementara ditutup — hubungi admin", tld))
		}
		if req.Years < z.MinYears || req.Years > z.MaxYears {
			return httpx.Err(c, fiber.StatusBadRequest, "years_out_of_range",
				fmt.Sprintf("TLD .%s butuh registrasi %d-%d tahun", tld, z.MinYears, z.MaxYears))
		}
	}

	// Fetch retail price dari platform_prices lokal.
	retailReg, _, err := h.pricingRepo.GetPlatformPrice(c.Context(), tld)
	if err != nil {
		return httpx.Err(c, fiber.StatusBadRequest, "price_not_set",
			fmt.Sprintf("Harga TLD .%s belum di-set admin. Hubungi support.", tld))
	}

	// Promo — validate + hitung discount sebelum invoice.CreateForRegister.
	// Redemption tersimpan setelah invoice created (butuh invoice.ID).
	var (
		promoID       uuid.UUID
		promoDiscount int64
	)
	if promoCode := strings.TrimSpace(req.PromoCode); promoCode != "" {
		if h.promos == nil {
			return httpx.Err(c, fiber.StatusServiceUnavailable, "promo_disabled",
				"Fitur promo belum aktif di server.")
		}
		subtotal := int64(req.Years) * retailReg
		pid, disc, err := h.promos.Validate(c.Context(), promoCode, owner.ID, tld, KindRegister, subtotal)
		if err != nil {
			return httpx.Err(c, fiber.StatusBadRequest, "promo_invalid", err.Error())
		}
		promoID = pid
		promoDiscount = disc
	}

	// Create invoice — service apply PPN via settings.
	invoiceID, total, dueAt, err := h.invoicesSvc.CreateForRegister(c.Context(), InvoiceCreateInput{
		UserID:        owner.ID,
		PurchasedBy:   purchasedBy,
		Domain:        req.Domain,
		Years:         req.Years,
		UnitPrice:     retailReg,
		PaymentMethod: req.PaymentMethod,
		Kind:          KindRegister,
		JobID:         "", // will use invoice.ID as job_id — no separate id
		PromoCode:     req.PromoCode,
		PromoDiscount: promoDiscount,
	})
	if err != nil {
		slog.Error("purchase: create invoice failed",
			"user_id", owner.ID, "domain", req.Domain, "error", err)
		return httpx.Internal(c, "gagal membuat invoice")
	}
	// Save job_id metadata now that we have invoice.ID. Alternative:
	// update metadata after create. Simplify by using invoice.ID as job_id
	// downstream — no separate UUID needed.
	jobID := invoiceID.String()

	// Redeem promo — insert row promo_redemptions. Non-fatal kalau gagal
	// (invoice sudah dibuat dengan diskon; redemption cuma untuk audit +
	// enforce limits di call berikutnya). Unique index cegah dobel-redeem.
	if promoDiscount > 0 && h.promos != nil {
		if err := h.promos.Redeem(c.Context(), promoID, owner.ID, invoiceID, promoDiscount); err != nil {
			slog.Warn("purchase: promo redeem failed",
				"invoice_id", invoiceID, "promo_id", promoID, "error", err)
		} else {
			h.logAudit(c.Context(), caller.ID, audit.EventPromoApplied, "invoice", invoiceID.String(), map[string]any{
				"promo_code": req.PromoCode,
				"promo_id":   promoID.String(),
				"discount":   promoDiscount,
				"kind":       KindRegister,
				"domain":     req.Domain,
			})
		}
	}

	// Zero-total short-circuit — kalau promo bikin total = 0, semua gateway
	// (Midtrans/Paylabs/wallet/manual_bank) reject Amount <= 0 dengan
	// "amount harus > 0". Handle sync flow: skip gateway, MarkPaid langsung,
	// lalu ExecuteAfterPayment inline (register EPP). Provider ref pakai
	// sentinel `free_promo_<invoice_id>` supaya audit trail tetap ada.
	isFreeInvoice := total == 0

	var paymentURL string
	var providerRef string
	var isWalletGateway bool

	if isFreeInvoice {
		providerRef = "free_promo_" + invoiceID.String()
		// Skip gateway — no charge. Purchase status akan sync path (mirip wallet).
	} else {
		// Resolve gateway.
		gw, gwErr := h.gwRegistry.Get(c.Context(), req.PaymentMethod)
		if gwErr != nil {
			return httpx.Err(c, fiber.StatusBadRequest, "gateway_unavailable",
				fmt.Sprintf("Payment method %q tidak tersedia: %v", req.PaymentMethod, gwErr))
		}
		isWalletGateway = gw.Type() == "wallet"

		// Charge — order_id = invoice.id string. Provider POST webhook nanti
		// dengan order_id ini, paymentwh lookup invoice by GetByGatewayRef
		// (setelah SavePaymentRef).
		//
		// Untuk wallet gateway (Type=="wallet"), CreateCharge sync debit —
		// balance dikurangi langsung + return ledger.id sebagai providerRef.
		//
		// Wallet payer resolution:
		//   - Reseller self-purchase / on-behalf-of → wallet reseller (caller)
		//   - Agent (self-purchase atau on-behalf-of) → wallet PARENT reseller,
		//     metadata catat agent_id supaya reseller bisa report per-agent.
		walletPayerID := ""
		var walletMeta []byte
		if req.PaymentMethod == "deposit_wallet" {
			if caller.Role == auth.RoleAgent && caller.ParentResellerID != nil {
				walletPayerID = caller.ParentResellerID.String()
				walletMeta = buildWalletMetadata(caller.ID, purchasedBy)
			} else {
				walletPayerID = caller.ID.String()
				walletMeta = buildWalletMetadata(uuid.Nil, purchasedBy)
			}
		}
		var chargeErr error
		paymentURL, providerRef, chargeErr = gw.CreateCharge(c.Context(), GatewayChargeRequest{
			OrderID:        invoiceID.String(),
			UserID:         owner.ID.String(),
			Amount:         total,
			Description:    fmt.Sprintf("Register %s (%d tahun)", req.Domain, req.Years),
			CustomerName:   owner.Name,
			CustomerEmail:  owner.Email,
			CustomerPhone:  owner.PhoneNumber,
			ReturnURL:      req.ReturnURL,
			ExpiresAt:      dueAt,
			WalletPayerID:  walletPayerID,
			WalletMetadata: walletMeta,
		})
		if chargeErr != nil {
			// Detect wallet insufficient — return 402 dengan message spesifik.
			if strings.Contains(strings.ToLower(chargeErr.Error()), "saldo") ||
				strings.Contains(strings.ToLower(chargeErr.Error()), "insufficient") {
				metrics.Default.CounterInc(metricPurchasesCreated,
					"Purchase checkout by outcome",
					map[string]string{"result": "wallet_insufficient", "gateway": req.PaymentMethod},
				)
				return httpx.Err(c, fiber.StatusPaymentRequired, "wallet_insufficient", chargeErr.Error())
			}
			slog.Error("purchase: charge failed",
				"gateway", req.PaymentMethod, "invoice_id", invoiceID, "error", chargeErr)
			metrics.Default.CounterInc(metricPurchasesCreated,
				"Purchase checkout by outcome",
				map[string]string{"result": "charge_failed", "gateway": req.PaymentMethod},
			)
			return httpx.Err(c, fiber.StatusBadGateway, "charge_failed", chargeErr.Error())
		}

		// Persist provider ref supaya webhook nanti bisa lookup + promote invoice
		// draft → unpaid.
		if err := h.invoicesSvc.SavePaymentRef(c.Context(), invoiceID, providerRef); err != nil {
			// Non-fatal — invoice tetap ada (status draft). Log + lanjut.
			slog.Warn("purchase: save payment ref failed",
				"invoice_id", invoiceID, "provider_ref", providerRef, "error", err)
		}
	}

	// Determine initial Purchase status. Wallet gateway + free invoice = sync
	// (langsung active setelah MarkPaid + EPP execute). Gateway lain =
	// pending_payment (menunggu webhook).
	syncFlow := isFreeInvoice || isWalletGateway
	purchaseStatus := StatusPendingPayment
	if syncFlow {
		purchaseStatus = StatusPendingProvisioning
	}

	// Save local Purchase.
	local := &Purchase{
		UserID:         owner.ID,
		PurchasedBy:    purchasedBy,
		RegistrarJobID: jobID,
		Domain:         req.Domain,
		Years:          req.Years,
		Status:         purchaseStatus,
		PaymentMethod:  req.PaymentMethod,
		PaymentURL:     paymentURL,
	}
	// Only persist user's provider choice if explicit (empty = ikut admin
	// default). CHECK constraint enforces valid enum at DB level.
	if choice := strings.TrimSpace(req.DNSProviderChoice); choice == "cloudflare" || choice == "dnscloud" {
		local.DNSProviderChoice = &choice
	}
	if err := h.repo.Create(c.Context(), local); err != nil {
		slog.Error("purchase: local save failed", "job_id", jobID, "error", err)
		// Non-fatal — invoice + charge sudah jalan. User bisa cek /invoices/:id.
	}

	metrics.Default.CounterInc(metricPurchasesCreated,
		"Purchase checkout by outcome",
		map[string]string{"result": "success", "gateway": req.PaymentMethod},
	)
	slog.Info("purchase: checkout accepted",
		"job_id", jobID, "invoice_id", invoiceID,
		"domain", req.Domain, "total", total,
		"gateway", req.PaymentMethod, "provider_ref", providerRef,
		"is_wallet", isWalletGateway, "on_behalf_of", purchasedBy != nil)

	// Audit trail — beda event untuk on-behalf-of supaya admin bisa filter.
	auditEvt := EventPurchaseCreated
	if purchasedBy != nil {
		auditEvt = EventPurchaseOnBehalfOf
	}
	auditMeta := map[string]any{
		"domain":         req.Domain,
		"years":          req.Years,
		"payment_method": req.PaymentMethod,
		"owner_id":       owner.ID.String(),
	}
	if len(req.DocumentIDs) > 0 {
		auditMeta["document_ids"] = req.DocumentIDs
	}
	h.logAudit(c.Context(), caller.ID, auditEvt, "domain_purchase", jobID, auditMeta)

	// Sync flow — wallet gateway (langsung debit) atau free invoice (total=0
	// via promo 100%). MarkPaid + EPP execute inline. Kalau gagal, invoice
	// tetap paid; admin/user retry manual via /purchases/:job_id/retry.
	finalStatus := purchaseStatus
	respPaymentURL := paymentURL
	if syncFlow {
		flowLabel := "wallet"
		if isFreeInvoice {
			flowLabel = "free"
		}
		if err := h.invoicesSvc.MarkPaid(c.Context(), invoiceID, time.Now(), providerRef); err != nil {
			slog.Error("purchase ("+flowLabel+"): MarkPaid failed",
				"invoice_id", invoiceID, "error", err)
			// Non-fatal for response — invoice biasanya bisa di-mark via admin panel.
		}
		inv, err := h.invoicesSvc.GetInvoiceForCallback(c.Context(), invoiceID)
		if err != nil {
			slog.Error("purchase ("+flowLabel+"): fetch invoice for execute failed",
				"invoice_id", invoiceID, "error", err)
		} else if inv != nil {
			if execErr := h.ExecuteAfterPayment(c.Context(), inv); execErr != nil {
				slog.Error("purchase ("+flowLabel+"): ExecuteAfterPayment failed",
					"invoice_id", invoiceID, "error", execErr)
				// Purchase status akan updated ke failed via ExecuteAfterPayment.
				finalStatus = StatusFailed
			} else {
				finalStatus = StatusActive
			}
		}
		respPaymentURL = "" // no redirect untuk sync flow
	}

	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"data": purchaseCreatedResp{
		JobID:      jobID,
		InvoiceID:  invoiceID.String(),
		Domain:     req.Domain,
		Status:     finalStatus,
		PaymentURL: respPaymentURL,
		Total:      total,
		Currency:   "IDR",
		DueAt:      dueAt.Format(time.RFC3339),
	}})
}

// extractTLD — "myshop.co.id" → "co.id". Return "" kalau tidak punya dot.
func extractTLD(domain string) string {
	i := strings.Index(domain, ".")
	if i < 0 {
		return ""
	}
	return domain[i+1:]
}

// buildWalletMetadata — encode audit context untuk wallet_ledger.metadata.
// agentID != uuid.Nil → caller adalah agent (report per-agent di reseller).
// forClientID != nil → on-behalf-of (agent/reseller beli buat klien).
// Return nil kalau tidak ada context tambahan (default metadata "{}" di repo).
func buildWalletMetadata(agentID uuid.UUID, forClientID *uuid.UUID) []byte {
	m := map[string]string{}
	if agentID != uuid.Nil {
		m["agent_id"] = agentID.String()
	}
	if forClientID != nil {
		m["for_client_id"] = forClientID.String()
	}
	if len(m) == 0 {
		return nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return b
}

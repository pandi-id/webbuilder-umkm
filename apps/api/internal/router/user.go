package router

import (
	"github.com/gofiber/fiber/v2"
	"github.com/webbuilder/api/internal/auth"
)

// MountUser registers /api/v1/* — auth endpoints (anonymous) and user routes
// (authenticated, but no role check).
//
// Rate limiting strategy:
//   - /auth/login + /auth/register + /auth/refresh: IP-based (no claims yet)
//   - Authenticated mutations: user-based, applied after auth.Required
//   - Uploads: tighter user-based limit (separate bucket)
//   - Reads (GET): no limit — cheap, idempotent
func MountUser(app *fiber.App, deps Deps) {
	// CORS strict — hanya domain platform (dashboard, admin panel) yang
	// boleh hit /api/v1/*. Applied per-mount karena /public/* butuh policy
	// berbeda (dynamic user domain).
	v1 := app.Group("/api/v1", dashboardCORS(deps.Cfg))

	// --- Anonymous + rate-limited per IP ---
	v1.Post("/auth/register", RateLimitIP(registerPerWindow, registerWindow), deps.Auth.Register)
	v1.Post("/auth/login", RateLimitIP(loginPerWindow, loginWindow), deps.Auth.Login)
	v1.Post("/auth/refresh", RateLimitIP(refreshPerWindow, refreshWindow), deps.Auth.Refresh)
	v1.Post("/auth/logout", deps.Auth.Logout)

	// Password reset + email verification. Both are anonymous endpoints (token
	// in body). IP-limited to throttle bulk-account abuse.
	v1.Post("/auth/password/forgot",
		RateLimitIP(passwordForgotPerWindow, passwordForgotWindow), deps.Auth.ForgotPassword)
	v1.Post("/auth/password/reset",
		RateLimitIP(passwordResetPerWindow, passwordResetWindow), deps.Auth.ResetPassword)
	v1.Post("/auth/email/verify",
		RateLimitIP(emailVerifyPerWindow, emailVerifyWindow), deps.Auth.ConfirmEmailVerification)

	// Reseller signup — anonymous. Rate-limit sama dengan register (cegah
	// bulk-account abuse). Admin approve nanti sebelum bisa login.
	v1.Post("/auth/reseller/apply",
		RateLimitIP(registerPerWindow, registerWindow), deps.Auth.ResellerApply)

	// Invitation accept — anonymous (auth via token). Dipakai agent/client
	// terima invite dari reseller/agent → set password → auto-login.
	v1.Get("/invitations/:token", deps.Auth.GetInvitation)
	v1.Post("/invitations/:token/accept",
		RateLimitIP(registerPerWindow, registerWindow), deps.Auth.AcceptInvitation)

	// Google OAuth — GET (browser redirect). Rate-limit /authorize per IP so a
	// bot can't spam state cookies. Callback is naturally rate-limited by
	// Google itself (needs a valid code round-trip).
	if deps.AuthGoogle != nil {
		v1.Get("/auth/google/authorize",
			RateLimitIP(loginPerWindow, loginWindow), deps.AuthGoogle.Authorize)
		v1.Get("/auth/google/callback", deps.AuthGoogle.Callback)
	}

	v1.Get("/templates", deps.Templates.List)
	v1.Get("/template-meta", deps.Templates.Meta)
	v1.Get("/templates/:slug", deps.Templates.Get)

	// --- Authenticated (any logged-in user) ---
	authed := v1.Group("/", auth.Required(deps.Issuer))

	authed.Get("/auth/me", deps.Auth.Me)
	authed.Patch("/auth/me", RateLimitUser(mutationPerWindow, mutationWindow), deps.Auth.UpdateMe)
	authed.Post("/auth/email/resend",
		RateLimitUser(emailResendPerWindow, emailResendWindow), deps.Auth.RequestEmailVerification)

	// Generic mutation budget — applied to all write endpoints below via a
	// sub-group so we don't re-declare per-route. Reads (GET) skip this.
	mutateLimit := RateLimitUser(mutationPerWindow, mutationWindow)

	// Sites
	authed.Get("/sites", deps.Sites.List)
	authed.Post("/sites", mutateLimit, deps.Sites.Create)
	authed.Get("/sites/:id", deps.Sites.Get)
	authed.Patch("/sites/:id", mutateLimit, deps.Sites.Update)
	authed.Delete("/sites/:id", mutateLimit, deps.Sites.Delete)
	authed.Post("/sites/:id/publish", mutateLimit, deps.Sites.Publish)
	// Reset per-block color override (themeOverride + layout.bg) di semua page.
	// Untuk case user ubah global theme tapi block masih pakai warna snapshot
	// lama dari template. Spacing (padding/margin) tetap.
	authed.Post("/sites/:id/reset-block-styles", mutateLimit, deps.Pages.ResetBlockStyles)

	// Site members (Phase 4 collab). Read: siapapun yang punya akses; write:
	// owner-only (add/remove) atau self (leave). Endpoint add belum expose
	// via wizard di Phase 4 — reseller auto-add lewat purchase flow.
	authed.Get("/sites/:id/members", deps.Sites.ListMembers)
	authed.Delete("/sites/:id/members/:user_id", mutateLimit, deps.Sites.RemoveMember)
	authed.Post("/sites/:id/leave", mutateLimit, deps.Sites.LeaveSite)
	// Phase 5 — aggregate list untuk halaman /settings/collaborators.
	authed.Get("/collaborators", deps.Sites.ListMyCollaborators)
	// Sisi kebalikan: sites di mana caller adalah non-owner member.
	// Dipakai agent/reseller portal untuk lihat situs klien yang mereka
	// bantu kelola (mereka bukan owner).
	authed.Get("/collaborations", deps.Sites.ListMyCollaborations)
	authed.Post("/sites/:id/export", mutateLimit, deps.Export.Export)
	authed.Get("/sites/:id/usage", deps.Usage.Current)
	authed.Get("/sites/:id/usage/history", deps.Usage.History)
	authed.Post("/sites/:id/apply-template", mutateLimit, deps.Templates.ApplyToSite)
	authed.Post("/sites/from-template/:slug", mutateLimit, deps.Templates.CreateSiteFromTemplate)

	// Pages
	authed.Get("/sites/:id/pages", deps.Pages.ListBySite)
	authed.Post("/sites/:id/pages", mutateLimit, deps.Pages.CreateForSite)
	authed.Get("/pages/:id", deps.Pages.Get)
	authed.Patch("/pages/:id", mutateLimit, deps.Pages.Update)
	authed.Post("/pages/:id/duplicate", mutateLimit, deps.Pages.Duplicate)
	authed.Get("/pages/:id/versions", deps.Pages.ListVersions)
	authed.Post("/pages/:id/restore/:versionId", mutateLimit, deps.Pages.RestoreVersion)
	authed.Post("/pages/:id/publish", mutateLimit, deps.Pages.Publish)
	authed.Post("/pages/:id/unpublish", mutateLimit, deps.Pages.Unpublish)
	authed.Post("/pages/:id/schedule", mutateLimit, deps.Pages.Schedule)
	authed.Post("/pages/:id/unschedule", mutateLimit, deps.Pages.Unschedule)
	authed.Post("/pages/:id/preview-token", mutateLimit, deps.Pages.PreviewToken)
	authed.Delete("/pages/:id", mutateLimit, deps.Pages.Delete)

	// Assets — separate, tighter limit (uploads are expensive).
	if deps.Assets != nil {
		uploadLimit := RateLimitUser(uploadPerWindow, uploadWindow)
		authed.Get("/sites/:id/assets", deps.Assets.ListBySite)
		authed.Post("/sites/:id/assets", uploadLimit, deps.Assets.Upload)
		// Delete di path top-level (bukan nested site) supaya URL predictable
		// tanpa harus fetch asset dulu untuk tau site_id-nya.
		authed.Delete("/assets/:id", mutateLimit, deps.Assets.Delete)
	}

	// Domains (legacy: custom hostname via A record + Caddy ACME).
	authed.Get("/sites/:id/domains", deps.Domains.ListBySite)
	authed.Post("/sites/:id/domains", mutateLimit, deps.Domains.Add)
	authed.Post("/domains/:id/verify", mutateLimit, deps.Domains.Verify)
	authed.Delete("/domains/:id", mutateLimit, deps.Domains.Delete)

	// BYO .id domains via Cloudflare NS delegation. 1 per site. Nil-safe
	// (deps.SiteBYODomains = nil kalau CF belum di-wire → endpoints skipped).
	//
	// GET /sites/:id/domains sudah di-mount di atas (legacy). BYO list combined
	// (anchor + byo) exposed di path baru supaya dashboard bisa fetch 1x.
	if deps.SiteBYODomains != nil {
		authed.Get("/sites/:id/domains-combined", deps.SiteBYODomains.List)
		authed.Post("/sites/:id/byo-domain/check", mutateLimit, deps.SiteBYODomains.Check)
		authed.Post("/sites/:id/byo-domain/connect", mutateLimit, deps.SiteBYODomains.Connect)
		authed.Post("/sites/:id/byo-domain/verify", mutateLimit, deps.SiteBYODomains.Verify)
		authed.Delete("/sites/:id/byo-domain", mutateLimit, deps.SiteBYODomains.Delete)
		authed.Post("/sites/:id/domains/primary", mutateLimit, deps.SiteBYODomains.SetPrimary)
	}

	// Domain purchase — Phase 3 self-sufficient (semua flow lewat api-registry
	// + local invoices/wallet/documents). Nil-safe kalau feature disabled.
	if deps.DomainPurchase != nil {
		authed.Post("/domains/check", mutateLimit, deps.DomainPurchase.Check)
		// Purchase + renew guarded dengan limit lebih ketat (money-moving ops).
		purchaseLimit := RateLimitUser(purchasePerWindow, purchaseWindow)
		// Purchase — 2-phase self-sufficient checkout. Invoice + payment
		// lokal, EPP execute lewat api-registry via ExecuteAfterPayment.
		authed.Post("/domains/purchase", purchaseLimit, deps.DomainPurchase.Purchase)
		// Renew — 2-phase self-sufficient. Path param `:name` untuk domain.
		// Ownership check via GetLatestActiveByDomain.
		authed.Post("/domains/:name/renew", purchaseLimit, deps.DomainPurchase.Renew)
		// Domain management (nameservers + whois + contact) — semua verify ownership.
		authed.Get("/domains/:name/nameservers", deps.DomainPurchase.GetNameservers)
		authed.Post("/domains/:name/nameservers", mutateLimit, deps.DomainPurchase.UpdateNameservers)
		authed.Get("/domains/:name/whois", deps.DomainPurchase.Whois)
		authed.Patch("/domains/:name/contact", mutateLimit, deps.DomainPurchase.UpdateContact)
		// DNS editor — proxy ke Cloudflare, scoped domain ownership. Fitur
		// disable-graceful kalau CF config absent (503 dari handler).
		authed.Get("/domains/:name/dns", deps.DomainPurchase.ListDNSRecords)
		authed.Post("/domains/:name/dns", mutateLimit, deps.DomainPurchase.CreateDNSRecord)
		authed.Patch("/domains/:name/dns/:record_id", mutateLimit, deps.DomainPurchase.UpdateDNSRecord)
		authed.Delete("/domains/:name/dns/:record_id", mutateLimit, deps.DomainPurchase.DeleteDNSRecord)
		// Cloudflare health check — troubleshoot "domain tidak bisa diakses".
		// Return zone status + NS sync + apex/www record + platform IP match.
		authed.Get("/domains/:name/cloudflare-info", deps.DomainPurchase.CloudflareInfo)
		authed.Get("/domains/:name/dnscloud-info", deps.DomainPurchase.DNSCloudInfo)
		// Switch DNS provider (user-scoped, ownership check inklusif
		// on-behalf-of). Pakai saat user flip NS manual di PANDI dan perlu
		// sinkron state DB ke provider baru.
		authed.Post("/domains/:name/switch-provider", mutateLimit, deps.DomainPurchase.UserSwitchProvider)
		// Aggregate current-state per FQDN (tabel `domains`) — replacement
		// untuk /purchases list yang campur register + renew per domain.
		// Cocok untuk "domain saya" view. Detail transaksi tetap di /purchases.
		authed.Get("/domains", deps.DomainPurchase.ListDomains)
		// Local job tracker — list milik user + individual job status.
		authed.Get("/domains/purchases", deps.DomainPurchase.List)
		authed.Get("/domains/purchases/:job_id", deps.DomainPurchase.Status)
		// Attach site ke job yang sudah active (link ke sites row lokal).
		authed.Post("/domains/purchases/:job_id/attach", mutateLimit, deps.DomainPurchase.Attach)
		// Retry — re-run ExecuteAfterPayment untuk failed job (invoice paid
		// tapi EPP CREATE gagal). Tidak bayar ulang.
		authed.Post("/domains/purchases/:job_id/retry", mutateLimit, deps.DomainPurchase.Retry)
	}

	// Products
	authed.Get("/sites/:id/products", deps.Products.ListBySite)
	authed.Post("/sites/:id/products", mutateLimit, deps.Products.Create)
	authed.Get("/products/:id", deps.Products.Get)
	authed.Patch("/products/:id", mutateLimit, deps.Products.Update)
	authed.Delete("/products/:id", mutateLimit, deps.Products.Delete)

	// Block snippets — per-user reusable block library
	authed.Get("/snippets", deps.Snippets.List)
	authed.Post("/snippets", mutateLimit, deps.Snippets.Create)
	authed.Patch("/snippets/:id", mutateLimit, deps.Snippets.Rename)
	authed.Delete("/snippets/:id", mutateLimit, deps.Snippets.Delete)

	// Blog posts
	authed.Get("/sites/:id/blog-posts", deps.Blog.ListBySite)
	authed.Post("/sites/:id/blog-posts", mutateLimit, deps.Blog.Create)
	authed.Get("/blog-posts/:id", deps.Blog.Get)
	authed.Patch("/blog-posts/:id", mutateLimit, deps.Blog.Update)
	authed.Post("/blog-posts/:id/publish", mutateLimit, deps.Blog.Publish)
	authed.Delete("/blog-posts/:id", mutateLimit, deps.Blog.Delete)

	// Analytics summary — read-only, no rate limit. Public beacon di global.go.
	if deps.Analytics != nil {
		authed.Get("/sites/:id/analytics", deps.Analytics.GetSummary)
	}

	// Forms — CRUD form definitions + submissions inbox. Public submit endpoint
	// terpisah di /public/forms/:id/submit (di router/global.go).
	if deps.Forms != nil {
		authed.Get("/sites/:id/forms", deps.Forms.ListBySite)
		authed.Post("/sites/:id/forms", mutateLimit, deps.Forms.CreateForSite)
		authed.Patch("/forms/:id", mutateLimit, deps.Forms.Update)
		authed.Delete("/forms/:id", mutateLimit, deps.Forms.Delete)
		authed.Get("/forms/:id/submissions", deps.Forms.ListSubmissions)
		authed.Delete("/form-submissions/:id", mutateLimit, deps.Forms.DeleteSubmission)
	}

	// Reseller portal endpoints — Phase 2+.
	// Nil-safe kalau handler belum di-wire di main.
	//
	// PENTING: Fiber Group(prefix, mw) internally = Use(prefix, mw). Grup dengan
	// prefix "/" bocorkan middleware ke SEMUA endpoint di bawah v1 (termasuk
	// /admin/*). Karena itu di sini pakai `authed` untuk auth.Required (yang
	// sudah scoped "/" tapi harmless karena auth.Required idempotent + fast),
	// dan role check di-attach PER-ROUTE via handler slice, bukan Group.
	if deps.Reseller != nil {
		roleReseller := auth.RequireReseller()
		roleAgent := auth.RequireAgent()
		roleResellerOrAgent := auth.RequireResellerOrAgent()

		// Reseller-only (invite agent + list agent + stats + pricing write).
		authed.Post("/reseller/agents/invite", roleReseller, mutateLimit, deps.Reseller.InviteAgent)
		authed.Get("/reseller/agents", roleReseller, deps.Reseller.ListAgents)
		authed.Get("/reseller/agents/:agent_id", roleReseller, deps.Reseller.GetAgent)
		authed.Get("/reseller/agents/:agent_id/clients", roleReseller, deps.Reseller.ListAgentClients)
		authed.Get("/reseller/agents/:agent_id/purchases", roleReseller, deps.Reseller.ListAgentPurchases)
		authed.Get("/reseller/stats", roleReseller, deps.Reseller.GetStats)

		// Reseller ATAU agent boleh (invite/list/update client).
		authed.Post("/reseller/clients", roleResellerOrAgent, mutateLimit, deps.Reseller.CreateClient)
		authed.Get("/reseller/clients", roleResellerOrAgent, deps.Reseller.ListClients)
		authed.Get("/reseller/clients/:client_id", roleResellerOrAgent, deps.Reseller.GetClient)
		authed.Patch("/reseller/clients/:client_id", roleResellerOrAgent, mutateLimit, deps.Reseller.UpdateClient)

		// Agent-only mirror (list assigned clients dari POV agent).
		authed.Get("/agent/clients", roleAgent, deps.Reseller.ListClients)
		authed.Get("/agent/clients/:client_id", roleAgent, deps.Reseller.GetClient)
		authed.Patch("/agent/clients/:client_id", roleAgent, mutateLimit, deps.Reseller.UpdateClient)
		authed.Get("/agent/stats", roleAgent, deps.Reseller.GetStats)

		// Phase 3 — list domain purchase yang di-trigger on-behalf-of client.
		if deps.DomainPurchase != nil {
			authed.Get("/reseller/purchases", roleResellerOrAgent, deps.DomainPurchase.ListOnBehalfOf)
			authed.Get("/reseller/purchases.csv", roleResellerOrAgent, deps.DomainPurchase.ExportOnBehalfOfCSV)
			authed.Get("/agent/purchases", roleAgent, deps.DomainPurchase.ListOnBehalfOf)
			// Team-scope aggregate domain list (per FQDN) untuk portal
			// reseller/agent. Beda dari /purchases yang transaksi log.
			authed.Get("/reseller/domains", roleResellerOrAgent, deps.DomainPurchase.ListTeamDomains)
			authed.Get("/agent/domains", roleAgent, deps.DomainPurchase.ListTeamDomains)
		}

		// Aggregate invoices — reseller/agent lihat invoice sendiri + client
		// yang di-manage. Enrich dengan user_email + user_name di response.
		if deps.Invoices != nil {
			authed.Get("/reseller/invoices", roleResellerOrAgent, deps.Invoices.ListForTeam)
			authed.Get("/agent/invoices", roleAgent, deps.Invoices.ListForTeam)
		}

		// Legacy /reseller/wallet + /agent/wallet + /reseller/wallet/topup*
		// dihapus (Phase 1 self-sufficient). Frontend sekarang pakai `/wallet/v2`
		// (deps.WalletLocal, lihat di bawah).

		// Pricing (Phase 3.11-3.12).
		if deps.Pricing != nil {
			authed.Get("/reseller/pricing", roleResellerOrAgent, deps.Pricing.ResellerList)
			// Opsi TLD valid (dari platform_prices) — whitelist supaya reseller
			// tidak bisa add TLD sembarang.
			authed.Get("/reseller/pricing/platform-tlds", roleResellerOrAgent, deps.Pricing.ResellerListPlatformTLDs)
			authed.Post("/reseller/pricing", roleReseller, mutateLimit, deps.Pricing.ResellerUpsert)
			authed.Delete("/reseller/pricing/:id", roleReseller, mutateLimit, deps.Pricing.ResellerDelete)
			authed.Get("/agent/pricing", roleAgent, deps.Pricing.ResellerList)
		}
	}

	// Public resolve endpoint (Phase 3.14) — dipakai wizard untuk display
	// harga + transparency box (wholesale untuk reseller/agent, retail untuk
	// client). Response redacted per role di handler.
	if deps.Pricing != nil {
		authed.Get("/pricing/resolve/:tld", deps.Pricing.Resolve)
	}

	// Zones public — dipakai wizard cari domain untuk render TLD chip
	// (hanya zone active). Available untuk semua authenticated users.
	if deps.Zones != nil {
		authed.Get("/zones", deps.Zones.ListPublic)
	}

	// Payment methods public — dipakai wizard checkout untuk render pilihan
	// pembayaran (hanya enabled, credentials masked). Wizard tidak butuh
	// tahu credentials — hanya `code`, `label`, `type`, `config.snap_url`, dsb.
	if deps.Payments != nil {
		authed.Get("/payment-methods", deps.Payments.ListPublic)
	}

	// Invoices — self-sufficient invoice state machine + PDF renderer.
	if deps.Invoices != nil {
		authed.Get("/invoices", deps.Invoices.ListMine)
		authed.Get("/invoices/:id", deps.Invoices.GetMine)
		authed.Get("/invoices/:id/pdf", deps.Invoices.GetPDFMine)
	}

	// Wallet — self-sufficient wallet (balance + ledger + top-up). Semua
	// authenticated user boleh punya wallet (bukan hanya reseller/agent).
	if deps.WalletLocal != nil {
		authed.Get("/wallet", deps.WalletLocal.GetBalance)
		authed.Get("/wallet/ledger", deps.WalletLocal.ListLedger)
		// Agent-only: transaksi milik agent yang di-debit dari wallet
		// reseller induk. Filter di-tag via metadata.agent_id.
		authed.Get("/wallet/agent-activity", deps.WalletLocal.AgentActivity)
		// Reseller-only: breakdown per-agent (aggregate wallet ledger
		// caller by metadata.agent_id). Untuk reporting siapa pakai berapa.
		authed.Get("/wallet/agents-breakdown", deps.WalletLocal.AgentsBreakdown)
		// Top-up self-service — money-moving op, tighter limit.
		topupLimit := RateLimitUser(purchasePerWindow, purchaseWindow)
		authed.Post("/wallet/topup", topupLimit, deps.WalletLocal.CreateTopup)
		authed.Get("/wallet/topup", deps.WalletLocal.ListTopups)
		authed.Get("/wallet/topup/:id", deps.WalletLocal.GetTopup)
		// Bukti transfer (manual_bank flow). Upload multipart; preview inline
		// pakai base64 data URI (pattern documents_local.Show).
		uploadProofLimit := RateLimitUser(uploadPerWindow, uploadWindow)
		authed.Post("/wallet/topup/:id/proof", uploadProofLimit, deps.WalletLocal.UploadProof)
		authed.Get("/wallet/topup/:id/proof", deps.WalletLocal.GetProof)
	}

	// Documents — dokumen kepatuhan (KTP/NPWP/dll.) untuk domain register
	// di TLD yang butuh verifikasi identitas (mis. .id).
	if deps.Documents != nil {
		uploadLimit := RateLimitUser(uploadPerWindow, uploadWindow)
		authed.Get("/documents/categories", deps.Documents.ListCategories)
		authed.Get("/documents", deps.Documents.ListMine)
		authed.Post("/documents", uploadLimit, deps.Documents.Upload)
		authed.Get("/documents/:id", deps.Documents.Show)
		authed.Delete("/documents/:id", deps.Documents.Delete)
	}

	// Promos — user validate endpoint (dipakai wizard preview discount).
	// Admin CRUD di admin.go.
	if deps.Promos != nil {
		authed.Post("/promos/validate", mutateLimit, deps.Promos.Validate)
	}
}

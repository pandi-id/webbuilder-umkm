package router

import (
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/webbuilder/api/internal/admin"
	"github.com/webbuilder/api/internal/analytics"
	"github.com/webbuilder/api/internal/assets"
	"github.com/webbuilder/api/internal/audit"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/blog"
	"github.com/webbuilder/api/internal/caddy"
	"github.com/webbuilder/api/internal/cloudflare"
	"github.com/webbuilder/api/internal/config"
	"github.com/webbuilder/api/internal/dns_providers"
	"github.com/webbuilder/api/internal/documents_local"
	"github.com/webbuilder/api/internal/domain_purchase"
	"github.com/webbuilder/api/internal/domains"
	"github.com/webbuilder/api/internal/email_log"
	"github.com/webbuilder/api/internal/errortrack"
	"github.com/webbuilder/api/internal/exports"
	"github.com/webbuilder/api/internal/forms"
	"github.com/webbuilder/api/internal/invoices"
	"github.com/webbuilder/api/internal/pages"
	"github.com/webbuilder/api/internal/payments"
	"github.com/webbuilder/api/internal/paymentwh"
	platform_articles "github.com/webbuilder/api/internal/platform_articles"
	"github.com/webbuilder/api/internal/pricing"
	"github.com/webbuilder/api/internal/products"
	"github.com/webbuilder/api/internal/promos"
	"github.com/webbuilder/api/internal/public"
	"github.com/webbuilder/api/internal/registrar"
	"github.com/webbuilder/api/internal/reseller"
	"github.com/webbuilder/api/internal/settings"
	"github.com/webbuilder/api/internal/site_byo_domains"
	"github.com/webbuilder/api/internal/sites"
	"github.com/webbuilder/api/internal/snippets"
	"github.com/webbuilder/api/internal/templates"
	"github.com/webbuilder/api/internal/usage"
	"github.com/webbuilder/api/internal/wallet_local"
	"github.com/webbuilder/api/internal/zones"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Deps bundles every handler the router needs. Built in main, passed once.
type Deps struct {
	Cfg config.Config

	// Pool is used by /healthz to ping the database for liveness checks.
	Pool *pgxpool.Pool

	Issuer *auth.TokenIssuer

	Auth       *auth.Handler
	AuthGoogle *auth.GoogleHandler
	Sites      *sites.Handler
	// SitesRepo — dipakai HostSiteGuard middleware di /public/sites/:id/*
	// untuk verify Host header match site.id URL param (defense in depth
	// cross-tenant leak). Dipisah dari Sites handler supaya middleware
	// tidak butuh handler chain.
	SitesRepo *sites.Repo
	Pages     *pages.Handler
	Domains   *domains.Handler
	Templates *templates.Handler
	Export    *exports.Handler
	Assets    *assets.Handler // may be nil (storage init failed)
	Usage     *usage.Handler
	Products  *products.Handler
	Blog      *blog.Handler
	Snippets  *snippets.Handler

	Caddy  *caddy.Handler
	Public *public.Handler

	// PlatformArticles — blog / knowledge base level platform (bukan per-site).
	// Admin CRUD + public read. Konsumer: homepage marketing + /artikel.
	PlatformArticles *platform_articles.Handler

	// Registrar is the EPP client wrapping api-registry service. May be nil
	// (feature disabled when API_REGISTRY_URL is empty) — callers must nil-check.
	Registrar *registrar.Client

	// DomainPurchase — handler check/purchase/renew/retry + local job tracker.
	// Nil kalau registrar client tidak configured.
	DomainPurchase *domain_purchase.Handler

	Admin *admin.Handler

	// Cloudflare admin CRUD. Handler nil = fitur disabled (kalau perlu
	// dimatikan, cukup jangan build handler-nya di main). Router mount
	// nil-safe di admin.go.
	Cloudflare *cloudflare.Handler

	// DNSProviders — unified admin CRUD + priority + health untuk
	// multi-provider DNS (CF + DNSCloud). Nil-safe.
	DNSProviders *dns_providers.Handler

	// Forms — user CRUD form + submissions inbox + public submit endpoint.
	// Mount di user.go (JWT) + global.go (public POST /public/forms/:id/submit).
	Forms *forms.Handler

	// Analytics — page view counter. Public POST (renderer beacon) + authed
	// GET (dashboard summary). Nil-safe.
	Analytics *analytics.Handler

	// Reseller — Phase 2 handler untuk invite agent + create client + list.
	// Mount di /api/v1/reseller/* (reseller only) dan /api/v1/agent/* (agent
	// only). Nil kalau feature belum di-wire.
	Reseller *reseller.Handler

	// Audit — Phase 7 admin audit log viewer. Nil-safe.
	Audit *audit.Handler

	// EmailLog — admin email log viewer (debugging delivery). Nil-safe.
	EmailLog *email_log.Handler

	// Pricing — Phase 3.10+ 3-tier pricing (admin platform CRUD + reseller
	// list + wizard resolve). Nil = feature disabled.
	Pricing *pricing.Handler

	// Zones — TLD catalog (Phase 1 self-sufficient). Admin CRUD + public list
	// untuk wizard cari domain. Nil-safe.
	Zones *zones.Handler

	// Settings — system_settings key-value store (Phase 1 self-sufficient).
	// Admin CRUD untuk PPN rate, brand name, support contact, dsb. Konsumer
	// di package lain call *settings.Service accessor, bukan lewat Handler.
	Settings *settings.Handler

	// Payments — payment_methods catalog (Phase 1 self-sufficient). Admin
	// CRUD + toggle enable/disable + config credentials. Public endpoint
	// (enabled only, credentials masked) dipakai wizard render.
	Payments *payments.Handler

	// Invoices — Phase 1 self-sufficient invoice state machine. Admin + user
	// endpoints (list/detail/PDF). Manual bank verify via mark-paid.
	Invoices *invoices.Handler

	// PaymentWebhook — receiver `/webhooks/payment/:code`. Dispatch ke
	// paymentgw.Gateway.HandleWebhook + invoices.MarkPaid. Nil-safe.
	PaymentWebhook *paymentwh.Handler

	// WalletLocal — Phase 1 self-sufficient wallet (menggantikan legacy
	// wallet.Handler proxy). Endpoints canonical.
	// di /wallet/v2 supaya coexist dengan legacy sampai frontend migrate.
	WalletLocal *wallet_local.Handler

	// Documents — Phase 2 self-sufficient dokumen kepatuhan (KTP/NPWP/etc.)
	// untuk domain register di TLD yang butuh verifikasi identitas. Nil
	// kalau assetStorage tidak tersedia — routes skip.
	Documents *documents_local.Handler

	// Promos — Phase 3 kupon diskon. Admin CRUD + user validate endpoint.
	Promos *promos.Handler

	// SiteBYODomains — Phase 1 BYO .id domain attachment via Cloudflare NS
	// delegation. Nil = feature disabled (no CF config or registrar missing).
	SiteBYODomains *site_byo_domains.Handler

	// AssetStorage is consulted to decide whether to mount /uploads.
	AssetStorage assets.Storage // may be nil

	// ErrorTracker captures panics and 5xx errors. May be a disabled client
	// (nil DSN) — Capture is a noop in that case.
	ErrorTracker *errortrack.Client
}

// New builds a fiber.App with global middleware and all route groups mounted.
func New(deps Deps) *fiber.App {
	fiberCfg := fiber.Config{
		AppName:               "web-builder-api",
		DisableStartupMessage: false,
		// Generous read timeout for large multipart uploads; tight write timeout
		// keeps a stuck client from holding a worker forever.
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
		// Body limit covers multipart uploads (assets); single JSON requests are
		// well below this.
		BodyLimit: 25 * 1024 * 1024,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			// Ship 5xx to error tracker — 4xx are user errors, not actionable.
			if code >= 500 && deps.ErrorTracker != nil {
				deps.ErrorTracker.Capture(c.Context(), err, map[string]string{
					"method": c.Method(),
					"path":   c.Path(),
				})
			}
			return c.Status(code).JSON(fiber.Map{"error": fiber.Map{
				"code":    "error",
				"message": err.Error(),
			}})
		},
	}
	// TRUST_PROXY=true — Fiber c.IP() resolve dari X-Forwarded-For.
	// Wajib kalau API di-deploy behind Caddy/reverse proxy supaya rate limit
	// per-IP, view dedupe fingerprint, dan audit log dapet IP client asli
	// (bukan IP loopback proxy). JANGAN aktifkan kalau API expose langsung.
	if deps.Cfg.TrustProxy {
		fiberCfg.ProxyHeader = fiber.HeaderXForwardedFor
		fiberCfg.EnableTrustedProxyCheck = true
		// TrustedProxies kosong = terima semua proxy. Aman karena Caddy di
		// dalam network yang sama; kalau ada beberapa hop bisa list CIDR
		// spesifik di sini.
	}
	app := fiber.New(fiberCfg)

	app.Use(recover.New(recover.Config{
		EnableStackTrace: true,
		StackTraceHandler: func(c *fiber.Ctx, e interface{}) {
			err, ok := e.(error)
			if !ok {
				err = fiberPanic{Cause: e}
			}
			if deps.ErrorTracker != nil {
				deps.ErrorTracker.Capture(c.Context(), err, map[string]string{
					"method": c.Method(),
					"path":   c.Path(),
					"kind":   "panic",
				})
			}
		},
	}))
	app.Use(RequestID())
	app.Use(SlogLogger())
	app.Use(SecurityHeaders(deps.Cfg.AppEnv == "production"))
	// Compress JSON+HTML responses. Level=2 chosen for CPU/size balance — gzip
	// level 6 (default) is ~3x slower on large pages for marginal gains.
	app.Use(compress.New(compress.Config{Level: compress.LevelBestSpeed}))

	// CORS di-split per route group karena consumer-nya beda:
	//
	//   /api/v1/*   — dashboard admin/user, credentials-bearing (JWT). Strict
	//                 allowlist dari CORS_ORIGINS env. Hanya domain platform.
	//
	//   /public/*   — renderer-facing: analytics beacon, form submit, dsb.
	//                 Origin = domain user (dinamis, tidak dikenal saat startup).
	//                 Approve any HTTPS origin — semua domain user pasti HTTPS
	//                 via on-demand TLS Caddy. Localhost di-allow untuk dev.
	//                 Credentials=false (no session/JWT dari renderer browser).
	//
	// Note: applied per-mount di MountUser/MountAdmin/MountGlobal (bukan global)
	// supaya per-endpoint policy explicit.
	MountGlobal(app, deps)
	MountUser(app, deps)
	MountAdmin(app, deps)

	return app
}

// dashboardCORS — CORS strict untuk /api/v1/* (dashboard + admin). Allowlist
// dari CORS_ORIGINS env. AllowCredentials=true supaya JWT via Authorization
// header + refresh cookie diterima browser. Pakai di MountUser + MountAdmin.
//
// Origin matching toleran `www.` prefix: kalau `https://kubaca.id` ada di
// whitelist, `https://www.kubaca.id` juga match — hindari user harus
// double-list tiap variant.
func dashboardCORS(cfg config.Config) fiber.Handler {
	// Normalize whitelist ke set: strip trailing slash, lowercase host.
	allowed := make(map[string]struct{}, len(cfg.CORSOrigins))
	for _, o := range cfg.CORSOrigins {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "" {
			continue
		}
		allowed[strings.ToLower(o)] = struct{}{}
	}
	return cors.New(cors.Config{
		AllowOriginsFunc: func(origin string) bool {
			if origin == "" {
				return false
			}
			o := strings.TrimRight(strings.ToLower(origin), "/")
			if _, ok := allowed[o]; ok {
				return true
			}
			// Terima `www.` variant kalau non-www ada di whitelist (dan
			// sebaliknya) — mis. Origin: https://www.kubaca.id vs whitelist
			// https://kubaca.id.
			if strings.HasPrefix(o, "https://www.") {
				if _, ok := allowed["https://"+o[len("https://www."):]]; ok {
					return true
				}
			} else if strings.HasPrefix(o, "https://") {
				if _, ok := allowed["https://www."+o[len("https://"):]]; ok {
					return true
				}
			}
			return false
		},
		AllowCredentials: true,
		// Idempotency-Key wajib di whitelist — dipakai POST /domains/purchase +
		// /domains/renew supaya browser tidak block preflight (CORS spec: custom
		// header selain simple list harus di-declare eksplisit).
		AllowHeaders: "Origin,Content-Type,Accept,Authorization,Idempotency-Key",
		AllowMethods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
	})
}

// publicCORS — CORS permissive untuk /public/* (renderer-facing). Origin =
// domain user yang dinamis. Approve semua HTTPS origin (semua domain user
// pasti HTTPS via on-demand TLS Caddy). Localhost + *.localhost di-allow di
// dev/staging untuk renderer dev server (Caddy multi-tenant sering pakai
// pola `<slug>.localhost`). AllowCredentials=false — endpoint publik tidak
// butuh session/JWT.
func publicCORS(cfg config.Config) fiber.Handler {
	isProd := cfg.AppEnv == "production"
	return cors.New(cors.Config{
		AllowOriginsFunc: func(origin string) bool {
			if origin == "" {
				return false
			}
			// Prod: semua HTTPS origin OK. Attack surface: hanya bisa hit
			// endpoint publik (analytics beacon + form submit) yang sudah
			// rate-limited per IP + honeypot anti-spam.
			if strings.HasPrefix(origin, "https://") {
				return true
			}
			// Dev/staging: allow http origin dengan hostname localhost /
			// *.localhost / 127.0.0.1. Parse URL supaya port + subdomain
			// tidak bikin false-negative (contoh: http://myshop.localhost:3001).
			if !isProd {
				u, err := url.Parse(origin)
				if err == nil && u.Scheme == "http" {
					h := u.Hostname()
					if h == "localhost" || strings.HasSuffix(h, ".localhost") ||
						h == "127.0.0.1" {
						return true
					}
				}
			}
			return false
		},
		AllowCredentials: false,
		AllowHeaders:     "Origin,Content-Type,Accept",
		AllowMethods:     "GET,POST,OPTIONS",
	})
}

// fiberPanic wraps a non-error panic value so the error tracker sees an `error`.
type fiberPanic struct{ Cause any }

func (p fiberPanic) Error() string {
	return strings.TrimSpace(fmtAny(p.Cause))
}

// fmtAny is %v without importing fmt for one call; keeps this file's deps tight.
func fmtAny(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case error:
		return s.Error()
	default:
		return "panic: non-error value"
	}
}

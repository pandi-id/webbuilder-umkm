package router

import (
	"context"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cache"

	"github.com/webbuilder/api/internal/assets"
	"github.com/webbuilder/api/internal/metrics"
	"github.com/webbuilder/api/internal/public"
)

// MountGlobal registers public + infra routes (no auth required):
//   - /healthz, /
//   - /internal/caddy/ask (Caddy on-demand TLS hook)
//   - /public/* (renderer reads)
//   - /uploads/* (static, if storage driver is local)
func MountGlobal(app *fiber.App, deps Deps) {
	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"service": "web-builder-api"})
	})

	// Health endpoints split for k8s-style probes:
	//   - /livez : is the process running? (no deps — cheap; fail = restart pod)
	//   - /readyz: are deps ready? (db ping + storage; fail = pull out of LB)
	//   - /healthz: legacy / human-friendly aggregate (kept for back-compat)
	app.Get("/livez", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})
	app.Get("/readyz", func(c *fiber.Ctx) error {
		return readiness(c, deps)
	})
	app.Get("/healthz", func(c *fiber.Ctx) error {
		return readiness(c, deps)
	})

	// Prometheus scrape endpoint. Reachable without auth: in a typical k8s/Caddy
	// deploy this is only exposed on the internal network. Keep it cheap — no
	// DB hits, just registry render.
	app.Get("/metrics", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "text/plain; version=0.0.4")
		return c.Send(metrics.Default.Render())
	})

	// Local-disk storage serves uploaded files itself. Long cache headers since
	// asset URLs are immutable (content-hashed by the storage driver).
	if ls, ok := deps.AssetStorage.(assets.LocalServable); ok {
		app.Static(ls.LocalRoute(), ls.LocalDir(), fiber.Static{
			MaxAge: 60 * 60 * 24 * 365, // 1 year
		})
		slog.Info("storage: static mount", "route", ls.LocalRoute(), "dir", ls.LocalDir())
	}

	// Caddy on_demand_tls.ask
	app.Get("/internal/caddy/ask", deps.Caddy.Ask)

	// Registrar webhook receiver dihapus di Phase 3 self-sufficient — status
	// update job V2 lewat ExecuteAfterPayment (payment webhook callback),
	// bukan external HMAC callback.

	// Payment gateway webhook — Midtrans/Paylabs POST kesini setelah user
	// bayar. Signature verify per-code di paymentgw.Gateway.HandleWebhook,
	// bukan HMAC generic. Rate-limit per IP defence in depth.
	if deps.PaymentWebhook != nil {
		app.Post("/webhooks/payment/:code",
			RateLimitIP(webhookPerWindow, webhookWindow),
			deps.PaymentWebhook.Receive,
		)
	}

	// Public endpoints — di-hit dari browser di domain user (dinamis, tidak
	// dikenal saat startup). Pakai publicCORS yang approve semua HTTPS origin
	// + localhost dev. AllowCredentials=false karena endpoint publik tidak
	// pakai session/JWT.
	pubCORS := publicCORS(deps.Cfg)

	// Public form submission — no JWT (visitor situs anonymous). Anti-spam:
	// (1) rate limit 10/menit per IP, (2) honeypot field "_hp" di handler.
	// Kalau form_id tidak valid → 404 (tidak leak enumeration).
	if deps.Forms != nil {
		app.Post("/public/forms/:id/submit",
			pubCORS,
			RateLimitIP(formSubmitPerWindow, formSubmitWindow),
			deps.Forms.Submit,
		)
		// Public form definition — renderer fetch untuk render HTML form yang
		// benar (fields, labels, types). Notify email TIDAK di-return
		// (privacy). Cache 60s di edge (form definition jarang berubah).
		app.Get("/public/forms/:id", pubCORS, deps.Forms.GetPublic)
	}

	// Public analytics beacon — renderer POST hit setiap page render.
	// Rate-limit per IP (200/menit) supaya bot spam tidak bloat counter.
	if deps.Analytics != nil {
		app.Post("/public/analytics/pageview",
			pubCORS,
			RateLimitIP(analyticsPerWindow, analyticsWindow),
			deps.Analytics.RecordView,
		)
	}

	// Public read endpoints (renderer). Cache TTL di-split:
	//
	//   Short (5s)  — site-by-host, pages: theme + block tree yang user edit
	//                 di dashboard. User expect update visible segera setelah
	//                 save; 5s trade-off freshness vs DB load.
	//   Long (30s)  — products/blog: content-heavy tapi jarang berubah.
	//                 Cache lebih agresif untuk hemat DB.
	//
	// Kalau butuh instant refresh (mis. preview iframe di dashboard), pakai
	// endpoint /preview/:token yang bypass cache (dynamic per-token). Untuk
	// invalidation on-demand (dashboard save → purge), butuh implementasi
	// terpisah (TODO Phase 4).
	shortCache := cache.New(cache.Config{
		Expiration:   5 * time.Second,
		CacheControl: true,
	})
	longCache := cache.New(cache.Config{
		Expiration:   30 * time.Second,
		CacheControl: true,
	})

	pubBase := app.Group("/public", pubCORS)

	// hostGuard — defensive middleware yang cegah cross-tenant leak dengan
	// verify X-Renderer-Host header match site.id di URL param. Kalau renderer
	// (atau caller lain) pass site.id yang tidak sesuai host → 404 + log.
	// Backward compat: kalau header tidak ada, guard skip (test manual via
	// curl tetap jalan). Wire di ATAS cache middleware supaya rejected request
	// tidak ke-cache sebagai success.
	hostGuard := public.HostSiteGuard(deps.SitesRepo)

	// Fresh-critical: theme + page tree yang user edit langsung.
	pubBase.Get("/site-by-host", shortCache, deps.Public.SiteByHost)
	pubBase.Get("/sites/:id/pages", hostGuard, shortCache, deps.Public.ListPages)
	pubBase.Get("/sites/:id/pages/:slug", hostGuard, shortCache, deps.Public.PageBySlug)

	// Cacheable lebih lama.
	pubBase.Get("/sites/:id/products", hostGuard, longCache, deps.Public.ListProducts)
	pubBase.Get("/sites/:id/products/:slug", hostGuard, longCache, deps.Public.ProductBySlug)
	pubBase.Get("/sites/:id/blog-posts", hostGuard, longCache, deps.Public.ListBlogPosts)
	pubBase.Get("/sites/:id/blog-posts/:slug", hostGuard, longCache, deps.Public.BlogPostBySlug)

	// Platform Articles — public read (list + detail by slug) untuk homepage
	// blog / knowledge base. Cache pendek supaya admin publish langsung visible.
	// Bukan per-site — jadi tidak butuh hostGuard.
	if deps.PlatformArticles != nil {
		pubBase.Get("/platform-articles", shortCache, deps.PlatformArticles.PublicList)
		pubBase.Get("/platform-articles/:slug", shortCache, deps.PlatformArticles.PublicGetBySlug)
	}

	// Template live preview — dipakai renderer route /template-preview/:slug
	// + wizard client modal iframe. Hanya status='published' yang accessible.
	pubBase.Get("/template-preview/:slug", longCache, deps.Public.TemplatePreview)

	// Template preview by UUID — accept semua status (draft/archived/published).
	// Aman tanpa auth karena UUID unguessable (122-bit entropy). Dipakai admin
	// panel edit template untuk live preview versi yang belum di-publish.
	// Cache SHORT (5s) karena admin edit + preview cycle harus fresh.
	pubBase.Get("/template-preview-by-id/:id", shortCache, deps.Public.TemplatePreviewByID)

	// Preview-by-token — anonymous draft access for sharing unpublished pages
	// dengan reviewers. Token validates owner intent. Bypass cache — reviewer
	// harus lihat state persis saat token di-share.
	pubBase.Get("/preview/:token", deps.Pages.PreviewByToken)
}

// readiness returns per-dependency status so a load-balancer can pull the pod
// out of rotation when DB or storage is sick. Process-level liveness is the
// cheaper /livez endpoint — this one actually touches the world.
func readiness(c *fiber.Ctx, deps Deps) error {
	ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
	defer cancel()

	out := fiber.Map{
		"status": "ok",
		"checks": fiber.Map{},
	}
	checks := out["checks"].(fiber.Map)
	healthy := true

	// --- Database ---
	if deps.Pool != nil {
		if err := deps.Pool.Ping(ctx); err != nil {
			checks["db"] = fiber.Map{"status": "down", "error": err.Error()}
			healthy = false
		} else {
			checks["db"] = fiber.Map{"status": "up"}
		}
	} else {
		checks["db"] = fiber.Map{"status": "skipped"}
	}

	// --- Storage ---
	if deps.AssetStorage != nil {
		checks["storage"] = fiber.Map{
			"status": "up",
			"driver": deps.AssetStorage.Driver(),
		}
	} else {
		checks["storage"] = fiber.Map{"status": "down", "error": "not initialised"}
		// Not fatal — uploads disabled but rest of API works.
	}

	if !healthy {
		out["status"] = "degraded"
		return c.Status(fiber.StatusServiceUnavailable).JSON(out)
	}
	return c.JSON(out)
}

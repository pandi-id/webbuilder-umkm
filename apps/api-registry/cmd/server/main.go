// api-registry — internal service untuk domain lifecycle + EPP execution.
// Konsumen tunggal: web builder API (via internal HTTP + HMAC).
//
// Provider mode dipilih via API_REGISTRY_PROVIDER_MODE:
//   - `pandi_wrapper` : proxy ke registrar-api PANDI (Fase 1a — MVP).
//   - `epp_direct`    : native EPP client ke registry via teknispandi/epp-pandi-client
//                       (Fase 1b — customer registrars dengan EPP credentials sendiri).
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"

	"github.com/webbuilder/api-registry/internal/config"
	"github.com/webbuilder/api-registry/internal/contacts"
	"github.com/webbuilder/api-registry/internal/domains"
	"github.com/webbuilder/api-registry/internal/epp"
	"github.com/webbuilder/api-registry/internal/hosts"
	"github.com/webbuilder/api-registry/internal/httpx"
	"github.com/webbuilder/api-registry/internal/jobs"
	"github.com/webbuilder/api-registry/internal/metrics"
	mw "github.com/webbuilder/api-registry/internal/middleware"
	"github.com/webbuilder/api-registry/internal/openapi"
	"github.com/webbuilder/api-registry/internal/provider"
	"github.com/webbuilder/api-registry/internal/resilience"
	"github.com/webbuilder/api-registry/internal/security"
	"github.com/webbuilder/api-registry/internal/webhooks"
	"github.com/webbuilder/api-registry/internal/whois"
)

// Build-time variables (set via `go build -ldflags "-X main.version=..."`).
var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLevel(cfg.LogLevel),
	})))

	// Build provider berdasarkan mode. Wrap dengan Instrumented supaya semua
	// upstream call ke registrar / EPP ke-record di metrics tanpa manual per
	// handler.
	baseProvider, err := buildProvider(cfg)
	if err != nil {
		slog.Error("provider init failed", "err", err)
		os.Exit(1)
	}
	// Chain decorators: base → Resilience (retry + circuit) → Instrumented
	// (metrics). Order penting: Instrumented paling luar supaya metrics
	// counter increment sekali per request, bukan sekali per retry attempt.
	var pInner provider.Provider = baseProvider
	if cfg.ResilienceEnabled {
		pInner = resilience.NewProvider(baseProvider, resilience.Config{
			Enabled: true,
			Retry: resilience.RetryConfig{
				MaxAttempts:  cfg.RetryMaxAttempts,
				InitialDelay: cfg.RetryInitialDelay,
				MaxDelay:     cfg.RetryMaxDelay,
			},
			Breaker: resilience.BreakerConfig{
				FailureThreshold: cfg.CircuitFailureThreshold,
				CooldownPeriod:   cfg.CircuitCooldownPeriod,
			},
		})
		slog.Info("resilience: enabled",
			"retry_max_attempts", cfg.RetryMaxAttempts,
			"circuit_threshold", cfg.CircuitFailureThreshold,
			"circuit_cooldown", cfg.CircuitCooldownPeriod,
		)
	} else {
		slog.Warn("resilience: disabled — upstream errors akan langsung bocor ke consumer")
	}
	p := provider.NewInstrumented(pInner)
	slog.Info("provider ready",
		"name", baseProvider.Name(),
		"mode", cfg.ProviderMode,
		"caps", baseProvider.Capabilities(),
	)

	// Fiber app. BodyLimit 10 MiB — kasih headroom di atas MaxFileSize
	// document upload (8 MiB) + JSON overhead. Fiber default 4 MiB — terlalu
	// ketat untuk multipart KTP/NPWP.
	app := fiber.New(fiber.Config{
		AppName:               "api-registry",
		DisableStartupMessage: true,
		ErrorHandler:          errorHandler,
		BodyLimit:             10 * 1024 * 1024,
	})
	app.Use(recover.New())
	// Middleware order: RequestID (populate locals) → AccessLog (log + metrics)
	// → Concurrency (semaphore).
	app.Use(mw.RequestID())
	app.Use(mw.AccessLog())
	app.Use(mw.Concurrency(cfg.MaxConcurrent, cfg.RequestTimeout))

	registerInfraRoutes(app, p, cfg)

	// All /v1/* di-guard HMAC. Kalau secret kosong (dev), middleware skip.
	if cfg.InternalHMACSecret == "" {
		slog.Warn("INTERNAL_HMAC_SECRET kosong — dev mode, semua request accepted tanpa auth!")
	}
	// Middleware order per /v1:
	//   1. HMAC verify (secret enforced di prod)
	//   2. Per-IP rate limit (defense-in-depth kalau secret bocor)
	v1 := app.Group("/v1",
		security.HMACMiddleware(cfg.InternalHMACSecret),
		mw.RateLimitPerIP(cfg.RateLimitPerIP, cfg.RateLimitWindow),
	)

	// Jobs — audit + idempotency. Fase 1 pakai in-memory (cap 10k), evict
	// LRU-style kalau overflow. Fase 2 swap ke Postgres/Redis untuk persistence
	// + async worker (EPP direct).
	jobStore := jobs.NewMemoryStore(10000)
	tracker := jobs.NewTracker(jobStore)
	slog.Info("jobs: in-memory store enabled", "capacity", 10000)

	registerV1Routes(v1, p, tracker, jobStore)

	// Webhook relay — public path (upstream registrar tidak tau HMAC api-registry).
	// Verify signature dari registrar-api (UpstreamSecret) + forward ke web
	// builder dengan HMAC api-registry. Kalau URL kosong, cuma verify + audit.
	relay := webhooks.NewRelay(webhooks.Config{
		UpstreamSecret:   cfg.WebhookUpstreamSecret,
		WebbuilderURL:    cfg.WebbuilderWebhookURL,
		WebbuilderSecret: cfg.WebbuilderWebhookSecret,
		Timeout:          cfg.WebhookForwardTimeout,
	})
	webhookH := webhooks.NewHandler(relay)
	app.Post("/webhooks/registrar", webhookH.Receive)
	if relay.Enabled() {
		slog.Info("webhook relay: enabled", "target", cfg.WebbuilderWebhookURL)
	} else {
		slog.Info("webhook relay: audit-only mode (WEBBUILDER_WEBHOOK_URL kosong)")
	}

	// --- Graceful shutdown ---
	addr := ":" + cfg.Port
	slog.Info("api-registry listening",
		"addr", addr,
		"version", version,
		"commit", commit,
		"build_time", buildTime,
	)

	// Async listen — main-thread trap signal.
	listenErr := make(chan error, 1)
	go func() {
		if err := app.Listen(addr); err != nil {
			listenErr <- err
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-listenErr:
		slog.Error("listen failed", "err", err)
		os.Exit(1)
	case s := <-sig:
		slog.Info("shutdown signal diterima, draining in-flight requests…", "signal", s.String())
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := app.ShutdownWithContext(ctx); err != nil {
			slog.Error("shutdown gagal", "err", err)
			os.Exit(1)
		}
		// Provider cleanup — flush log + close file kalau ada.
		_ = p.Shutdown()
		slog.Info("shutdown selesai")
	}
}

// buildProvider — construct provider concrete berdasarkan ProviderMode.
// Return error kalau init gagal (bukan os.Exit — caller decide).
func buildProvider(cfg *config.Config) (provider.Provider, error) {
	switch cfg.ProviderMode {
	case "pandi_wrapper":
		return provider.NewPandiWrapper(provider.PandiWrapperConfig{
			BaseURL:     cfg.PandiAPIURL,
			StaticToken: cfg.PandiAPIKey,
			Email:       cfg.PandiEmail,
			Password:    cfg.PandiPassword,
			Timeout:     cfg.PandiAPITimeout,
		})
	case "epp_direct":
		p, err := epp.NewProvider(epp.Config{
			Host:               cfg.EPPHost,
			Port:               cfg.EPPPort,
			Username:           cfg.EPPUser,
			Password:           cfg.EPPPassword,
			CertFile:           cfg.EPPCertFile,
			KeyFile:            cfg.EPPKeyFile,
			CAFile:             cfg.EPPCAFile,
			InsecureSkipVerify: cfg.EPPInsecureSkipVerify,
			Timeout:            cfg.RequestTimeout,
			KeepAliveInterval:  cfg.EPPKeepAliveInterval,
			MaxRetries:         2,
			PerCommandSession:  cfg.EPPPerCommandSession,
			LogFile:            cfg.EPPLogFile,
			DebugXML:           cfg.EPPDebugXML,
		})
		if err != nil {
			return nil, err
		}
		// Startup sanity-check: connect + login sekali supaya credentials +
		// TLS + cert diverifikasi fail-fast. Dalam per-command mode, session
		// TIDAK di-reuse — first real command akan connect ulang.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := p.Connect(ctx); err != nil {
			return nil, fmt.Errorf("epp connect+login gagal: %w", err)
		}
		slog.Info("epp: startup handshake OK",
			"host", cfg.EPPHost, "port", cfg.EPPPort, "user", cfg.EPPUser,
			"per_command", cfg.EPPPerCommandSession, "log_file", cfg.EPPLogFile,
			"debug_xml", cfg.EPPDebugXML)
		if cfg.EPPDebugXML {
			slog.Warn("epp: XML debug dump ENABLED — JANGAN pakai di prod. Credential + PII bakal masuk log.")
		}
		// Per-command mode: tutup session startup supaya first real command
		// bikin session fresh (no dangling half-idle session).
		if cfg.EPPPerCommandSession {
			_ = p.Close()
		}
		return p, nil
	default:
		return nil, fiber.NewError(fiber.StatusBadRequest,
			"provider mode tidak dikenal: "+cfg.ProviderMode)
	}
}

// registerInfraRoutes — endpoint infrastruktur (no auth, no rate limit):
// healthz (liveness), readyz (readiness dengan upstream probe), version,
// metrics.
func registerInfraRoutes(app *fiber.App, p provider.Provider, cfg *config.Config) {
	// Liveness: process up + provider constructed.
	app.Get("/healthz", func(c *fiber.Ctx) error {
		return httpx.OK(c, fiber.Map{
			"ok":       true,
			"provider": p.Name(),
			"caps":     p.Capabilities(),
		})
	})

	// Readiness: liveness + upstream reachable. Kalau upstream (registrar-api)
	// down > 5 detik, return 503 supaya orchestrator (K8s / Compose HC) tandai
	// unhealthy dan traffic tidak di-route ke sini.
	app.Get("/readyz", func(c *fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), 5*time.Second)
		defer cancel()
		// Probe cheap: WHOIS untuk domain fake — provider fallback ke registry
		// tanpa charge apapun. Kalau upstream jenuh / down, error timeout.
		_, err := p.Whois(ctx, "example.invalid")
		if err != nil {
			// "not found" bukan indikator upstream down — treat as ready.
			// Cek error type: kalau upstream_error / rate_limit / timeout, unhealthy.
			return httpx.Err(c, fiber.StatusServiceUnavailable, "upstream_unreachable",
				"provider upstream tidak reachable: "+err.Error())
		}
		return httpx.OK(c, fiber.Map{"ready": true, "provider": p.Name()})
	})

	// Version endpoint — untuk deploy verification.
	app.Get("/version", func(c *fiber.Ctx) error {
		return httpx.OK(c, fiber.Map{
			"version":    version,
			"commit":     commit,
			"build_time": buildTime,
			"provider":   p.Name(),
			"mode":       cfg.ProviderMode,
		})
	})

	// Metrics — Prometheus text exposition.
	app.Get("/metrics", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		return c.SendString(metrics.Default.Expose())
	})

	// OpenAPI spec — machine-readable API contract untuk konsumer + tooling.
	app.Get("/openapi.json", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "application/json; charset=utf-8")
		return c.Send(openapi.Spec)
	})
}

// registerV1Routes — semua business endpoint di bawah /v1 (guarded HMAC).
func registerV1Routes(v1 fiber.Router, p provider.Provider, tracker *jobs.Tracker, jobStore jobs.Store) {
	dh := domains.NewHandler(p, tracker)
	v1.Get("/domains", dh.List)
	v1.Post("/domains/check", dh.Check)
	v1.Post("/domains/bulk-check", dh.BulkCheck)
	v1.Post("/domains/register", dh.Register)
	v1.Post("/domains/:name/renew", dh.Renew)
	v1.Get("/domains/register/:job_id/status", dh.Status)
	v1.Post("/domains/register/:job_id/retry", dh.Retry)
	v1.Post("/domains/register/:job_id/cancel", dh.Cancel)
	v1.Get("/domains/:name/info", dh.Info)

	jh := jobs.NewHandler(jobStore)
	v1.Get("/jobs", jh.List)
	v1.Get("/jobs/:id", jh.Get)

	hh := hosts.NewHandler(p)
	v1.Get("/domains/:name/nameservers", hh.Get)
	v1.Post("/domains/:name/nameservers", hh.Update)

	ch := contacts.NewHandler(p)
	v1.Get("/contacts/:id", ch.Get)
	v1.Patch("/contacts/:id", ch.Update)
	v1.Patch("/domains/:name/contact", ch.UpdateByDomain)

	wh := whois.NewHandler(p)
	v1.Get("/whois", wh.Whois)
}

// errorHandler — Fiber panics/errors → HTTP dengan envelope konsisten.
func errorHandler(c *fiber.Ctx, err error) error {
	if e, ok := err.(*fiber.Error); ok {
		return httpx.Err(c, e.Code, "fiber_error", e.Message)
	}
	return httpx.Internal(c, err.Error())
}

func parseLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

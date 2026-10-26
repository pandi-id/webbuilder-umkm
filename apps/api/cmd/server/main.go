package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"

	"github.com/webbuilder/api/internal/admin"
	"github.com/webbuilder/api/internal/analytics"
	"github.com/webbuilder/api/internal/assets"
	"github.com/webbuilder/api/internal/audit"
	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/blog"
	"github.com/webbuilder/api/internal/cachepurge"
	"github.com/webbuilder/api/internal/caddy"
	"github.com/webbuilder/api/internal/cloudflare"
	"github.com/webbuilder/api/internal/config"
	"github.com/webbuilder/api/internal/db"
	"github.com/webbuilder/api/internal/dns_providers"
	"github.com/webbuilder/api/internal/documents_local"
	"github.com/webbuilder/api/internal/domain_purchase"
	"github.com/webbuilder/api/internal/domains"
	"github.com/webbuilder/api/internal/email_log"
	"github.com/webbuilder/api/internal/errortrack"
	"github.com/webbuilder/api/internal/exports"
	"github.com/webbuilder/api/internal/forms"
	"github.com/webbuilder/api/internal/invoices"
	"github.com/webbuilder/api/internal/logging"
	"github.com/webbuilder/api/internal/mail"
	"github.com/webbuilder/api/internal/metrics"
	"github.com/webbuilder/api/internal/notifier"
	"github.com/webbuilder/api/internal/pages"
	"github.com/webbuilder/api/internal/paymentgw"
	"github.com/webbuilder/api/internal/payments"
	"github.com/webbuilder/api/internal/paymentwh"
	platform_articles "github.com/webbuilder/api/internal/platform_articles"
	"github.com/webbuilder/api/internal/pricing"
	"github.com/webbuilder/api/internal/products"
	"github.com/webbuilder/api/internal/promos"
	"github.com/webbuilder/api/internal/public"
	"github.com/webbuilder/api/internal/registrar"
	"github.com/webbuilder/api/internal/reseller"
	"github.com/webbuilder/api/internal/router"
	"github.com/webbuilder/api/internal/seed"
	"github.com/webbuilder/api/internal/settings"
	"github.com/webbuilder/api/internal/site_byo_domains"
	"github.com/webbuilder/api/internal/sites"
	"github.com/webbuilder/api/internal/snippets"
	"github.com/webbuilder/api/internal/templates"
	"github.com/webbuilder/api/internal/usage"
	"github.com/webbuilder/api/internal/wallet_local"
	"github.com/webbuilder/api/internal/zones"
)

func main() {
	// Auto-load .env from working dir (silent if missing). Existing OS env
	// always wins, so Docker Compose passthrough is unaffected.
	envErr := godotenv.Load()

	cfg := config.Load()
	logging.Setup(cfg.AppEnv, cfg.LogLevel)

	tracker, err := errortrack.Init(cfg.SentryDSN, cfg.AppEnv, "")
	if err != nil {
		slog.Warn("error tracker init failed (disabled)", "error", err)
	}
	if tracker.Enabled() {
		slog.Info("error tracker enabled")
	}

	if envErr != nil && !os.IsNotExist(envErr) {
		slog.Warn("dotenv load issue", "error", envErr)
	}

	if err := cfg.Validate(); err != nil {
		slog.Error("config validation failed", "error", err,
			"hint", "set APP_ENV=development to bypass these checks during dev")
		os.Exit(1)
	}

	// Rate limit kill-switch — pass-through semua RateLimitIP/RateLimitUser
	// kalau RATE_LIMIT_DISABLED=true. Log eksplisit supaya operator sadar.
	router.SetRateLimitDisabled(cfg.RateLimitDisabled)
	if cfg.RateLimitDisabled {
		slog.Warn("rate limit DISABLED via RATE_LIMIT_DISABLED=true — jangan pakai di production tanpa WAF/CDN di depan")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.ConnectWith(ctx, cfg.DatabaseURL, db.PoolOptions{
		MaxConns:           int32(cfg.DBMaxConns),
		MinConns:           int32(cfg.DBMinConns),
		MaxConnLifetime:    cfg.DBMaxConnLifetime,
		MaxConnIdleTime:    cfg.DBMaxConnIdleTime,
		SlowQueryThreshold: cfg.DBSlowQueryThreshold,
	})
	if err != nil {
		slog.Error("db connect failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Periodic pool snapshot so /metrics exposes acquire/idle counts. 5s tick
	// keeps cardinality low and matches typical Prometheus scrape intervals.
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s := db.Snapshot(pool)
				metrics.Default.GaugeSet("db_pool_acquired", "Currently checked-out conns", nil, int64(s.Acquired))
				metrics.Default.GaugeSet("db_pool_idle", "Idle conns in pool", nil, int64(s.Idle))
				metrics.Default.GaugeSet("db_pool_total", "Total conns in pool", nil, int64(s.Total))
				metrics.Default.GaugeSet("db_pool_max", "Pool max conns", nil, int64(s.MaxConns))
			}
		}
	}()

	if err := db.Migrate(ctx, pool, cfg.DatabaseURL); err != nil {
		slog.Error("db migrate failed", "error", err)
		os.Exit(1)
	}

	// Repositories
	authRepo := auth.NewRepo(pool)
	siteRepo := sites.NewRepo(pool)
	pageRepo := pages.NewRepo(pool)
	domainRepo := domains.NewRepo(pool)
	templateRepo := templates.NewRepo(pool)
	assetRepo := assets.NewRepo(pool)
	productRepo := products.NewRepo(pool)
	blogRepo := blog.NewRepo(pool)
	platformArticlesRepo := platform_articles.NewRepo(pool)
	snippetRepo := snippets.NewRepo(pool)
	adminRepo := admin.NewRepo(pool)
	purchaseRepo := domain_purchase.NewRepo(pool)
	cloudflareRepo := cloudflare.NewRepo(pool)
	byoRepo := site_byo_domains.NewRepo(pool)
	formsRepo := forms.NewRepo(pool)
	analyticsRepo := analytics.NewRepo(pool)

	if err := seed.Run(ctx, seed.Deps{
		Pool:      pool,
		Auth:      authRepo,
		Templates: templateRepo,
		Sites:     siteRepo,
		Pages:     pageRepo,
		Products:  productRepo,
		Blog:      blogRepo,
	}, seed.Options{
		AdminEmail:    cfg.AdminEmail,
		AdminPassword: cfg.AdminPassword,
		AdminName:     cfg.AdminName,
		Demo:          cfg.SeedDemo,
		DemoEmail:     cfg.SeedDemoEmail,
		DemoPassword:  cfg.SeedDemoPassword,
	}); err != nil {
		slog.Warn("seed failed", "error", err)
	}

	// Storage (driver picks local or s3)
	assetStorage, err := assets.NewStorage(ctx, assets.Config{
		Driver:         assets.Driver(cfg.StorageDriver),
		S3Endpoint:     cfg.StorageS3Endpoint,
		S3AccessKey:    cfg.StorageS3AccessKey,
		S3SecretKey:    cfg.StorageS3SecretKey,
		S3Region:       cfg.StorageS3Region,
		S3Bucket:       cfg.StorageS3Bucket,
		S3UseSSL:       cfg.StorageS3UseSSL,
		S3PublicURL:    cfg.StorageS3PublicURL,
		LocalDir:       cfg.StorageLocalDir,
		LocalPublicURL: cfg.StorageLocalPublicURL,
	})
	if err != nil {
		slog.Warn("asset storage init failed (uploads disabled)", "error", err)
	}
	if assetStorage != nil {
		slog.Info("storage ready", "driver", assetStorage.Driver())
	}

	// Mail sender — driver "log" in dev, "smtp" in prod.
	mailer, err := mail.New(mail.Config{
		Driver:   cfg.MailDriver,
		Host:     cfg.SMTPHost,
		Port:     cfg.SMTPPort,
		Username: cfg.SMTPUsername,
		Password: cfg.SMTPPassword,
		From:     cfg.SMTPFrom,
		StartTLS: cfg.SMTPStartTLS,
	})
	if err != nil {
		slog.Error("mail init failed", "error", err)
		os.Exit(1)
	}
	slog.Info("mail ready", "driver", mailer.Driver())

	// Email log — wrap mailer supaya tiap Send() insert 1 row `email_log`
	// untuk audit + debugging delivery. Kalau mailer / repo nil, Wrap
	// returns underlying apa adanya (no-op).
	emailLogRepo := email_log.NewRepo(pool)
	mailer = email_log.Wrap(mailer, emailLogRepo)
	emailLogHandler := email_log.NewHandler(emailLogRepo)

	// Handlers
	issuer := auth.NewTokenIssuer(cfg.JWTSecret, cfg.JWTAccessTTL, cfg.JWTRefreshTTL)
	usageRepo := usage.NewRepo(pool, siteRepo, pageRepo, assetRepo)

	authHandler := auth.NewHandler(authRepo, issuer, auth.HandlerOptions{
		Mailer:     mailer,
		AppBaseURL: cfg.AppBaseURL,
	})

	registrarClient, err := registrar.New(registrar.Config{
		APIRegistryURL:        cfg.APIRegistryURL,
		APIRegistryHMACSecret: cfg.APIRegistryHMACSecret,
		APIRegistryTimeout:    cfg.APIRegistryTimeout,
	})
	if err != nil {
		slog.Error("registrar client init failed", "error", err)
		os.Exit(1)
	}
	if registrarClient != nil {
		slog.Info("registrar client: enabled (self-sufficient, EPP via api-registry)",
			"api_registry_url", cfg.APIRegistryURL, "timeout", cfg.APIRegistryTimeout)
	} else {
		slog.Info("registrar client: disabled (set API_REGISTRY_URL untuk enable domain flow)")
	}

	// Zones — Phase 1 self-sufficient TLD catalog. Di-construct sebelum
	// purchaseHandler karena purchaseHandler.SetZones butuh instance ini
	// untuk cross-check zone active saat CheckDomain.
	zonesRepo := zones.NewRepo(pool)
	zonesHandler := zones.NewHandler(zonesRepo)

	// Domain purchase handler menyatukan repo lokal + registrar client + user
	// repo (untuk ambil profil kontak). Hanya di-build kalau registrar client
	// aktif — kalau nil, route domain purchase auto-skip di router.
	var purchaseHandler *domain_purchase.Handler
	if registrarClient != nil {
		// Dokumen (KTP/NPWP) BUKAN disimpan di web builder — flow multipart
		// upload diteruskan langsung ke registrar via AttachDocument handler.
		// Single source of truth = registrar.
		purchaseHandler = domain_purchase.NewHandler(
			purchaseRepo, registrarClient, authRepo, siteRepo, cloudflareRepo,
			cfg.PlatformIPs,
		)
		// Inject local zones — filter TLD hasil check ke hanya yang active
		// di zones catalog. Operator kontrol full via /admin/zones.
		purchaseHandler.SetZones(zonesRepo)

		// Expiry notifier — scan tiap 24 jam, email user kalau domain aktif
		// mendekati expire (≤ 30 hari). Dedup per domain via kolom
		// expiry_notice_sent_at + resend window 7 hari.
		//
		// Hanya jalan kalau registrar aktif (kalau tidak ada purchase, tidak
		// ada yang perlu di-notify). Mailer driver "log" tetap OK — email
		// akan muncul di stdout untuk verifikasi dev.
		expiry := notifier.NewExpiry(purchaseRepo, mailer, notifier.ExpiryConfig{
			Interval:    24 * time.Hour,
			Within:      30 * 24 * time.Hour,
			ResendAfter: 7 * 24 * time.Hour,
			AppBaseURL:  cfg.AppBaseURL,
		})
		go expiry.Run(ctx)
	}

	googleHandler := auth.NewGoogleHandler(
		authRepo, authHandler,
		cfg.GoogleOAuthClientID, cfg.GoogleOAuthClientSecret, cfg.GoogleOAuthRedirectURL,
		cfg.AppBaseURL,
	)
	if googleHandler.Enabled() {
		slog.Info("google oauth: enabled", "redirect_url", cfg.GoogleOAuthRedirectURL)
	} else {
		slog.Info("google oauth: disabled (set GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URL to enable)")
	}

	// Cache purger — hubungkan domain lookup + Cloudflare purge. Nil-safe:
	// kalau CF repo / purchases nil, purger jadi no-op. Publish handler tetap
	// jalan tanpa error.
	purger := cachepurge.New(cloudflareRepo, purchaseRepo)

	sitesHandler := sites.NewHandler(siteRepo)
	sitesHandler.SetPurger(purger)
	// Storage-file cleanup untuk asset saat site di-delete. DB row cascade
	// otomatis lewat FK, tapi file bytes butuh cleanup eksplisit supaya
	// tidak numpuk orphan di S3/local disk. Nil-safe kalau storage disabled.
	if assetStorage != nil {
		sitesHandler.SetAssetCleaner(assets.NewSiteCleaner(assetRepo, assetStorage))
	}
	pagesHandler := pages.NewHandler(pageRepo, siteRepo, issuer)
	pagesHandler.SetPurger(purger)

	// Admin handler + inject authRepo untuk reseller management (Phase 1).
	// Reseller + purchases repo di-inject setelah dibuat (Phase 7 detail page).
	adminHandler := admin.NewHandler(adminRepo)
	adminHandler.SetAuthRepo(authRepo)
	adminHandler.SetTemplates(templateRepo)
	adminHandler.SetMailer(mailer)
	if assetStorage != nil {
		// Storage untuk admin-scoped uploads (template thumbnail Phase 7).
		adminHandler.SetStorage(assetStorage)
	}

	// Public handler — template preview endpoint butuh templates repo,
	// inject lewat SetTemplates (nil-safe).
	publicHandler := public.NewHandler(siteRepo, pageRepo, productRepo, blogRepo)
	publicHandler.SetTemplates(templateRepo)

	templatesHandler := templates.NewHandler(templateRepo, siteRepo, pageRepo, productRepo, blogRepo, purchaseRepo)
	if purchaseRepo != nil {
		adminHandler.SetPurchases(purchaseRepo)
	}

	// Reseller portal handler — Phase 2.
	resellerRepo := reseller.NewRepo(pool)
	resellerHandler := reseller.NewHandler(resellerRepo, authRepo, mailer, cfg.AppBaseURL)
	// Team-scope resolver — reseller repo implements ListTeamActorIDs.
	// Enable reseller portal untuk lihat collaborations agent-agent nya.
	sitesHandler.SetTeamScope(resellerRepo)
	adminHandler.SetReseller(resellerRepo)

	// Wire reseller assignment checker ke domain purchase handler (Phase 3
	// on-behalf-of). Kalau purchaseHandler nil (registrar disabled),
	// SetAssignmentChecker jadi no-op.
	if purchaseHandler != nil {
		purchaseHandler.SetAssignmentChecker(resellerRepo)
	}

	// Wire stats provider ke reseller handler (Phase 6). Adapter closure
	// hindari import cycle: reseller.StatsProvider interface butuh
	// *reseller.DomainStats, tapi purchaseRepo return *domain_purchase.ResellerStats.
	if purchaseRepo != nil {
		resellerHandler.SetStatsProvider(resellerStatsAdapter{repo: purchaseRepo})
	}

	// Audit log — Phase 7 append-only event trail. Repo di-inject ke handler
	// yang perlu record (auth reseller approve, invitation, purchase, dst.).
	auditRepo := audit.NewRepo(pool)
	auditHandler := audit.NewHandler(auditRepo)
	adminHandler.SetAudit(auditRepo)
	resellerHandler.SetAudit(auditRepo)
	if purchaseHandler != nil {
		purchaseHandler.SetAudit(auditRepo)
	}

	// Pricing — Phase 3.10+ 3-tier pricing model.
	pricingRepo := pricing.NewRepo(pool)
	pricingHandler := pricing.NewHandler(pricingRepo, authRepo)

	// Settings — Phase 1 self-sufficient key-value store.
	settingsRepo := settings.NewRepo(pool)
	settingsSvc := settings.NewService(settingsRepo)
	settingsHandler := settings.NewHandler(settingsRepo, settingsSvc)

	// Payments — Phase 1 self-sufficient payment_methods catalog.
	paymentsRepo := payments.NewRepo(pool)
	paymentsHandler := payments.NewHandler(paymentsRepo)

	// Wallet local — Phase 1 self-sufficient wallet (menggantikan legacy
	// legacy proxy).
	walletLocalRepo := wallet_local.NewRepo(pool)
	walletLocalHandler := wallet_local.NewHandler(walletLocalRepo)

	// Documents local — Phase 2 self-sufficient. Blob di-simpan di
	// assets.Storage (local disk atau S3), metadata di tabel documents.
	// Nil kalau assetStorage nil (storage init gagal) → routes skip di router.
	var documentsHandler *documents_local.Handler
	if assetStorage != nil {
		documentsRepo := documents_local.NewRepo(pool)
		documentsHandler = documents_local.NewHandler(documentsRepo, assetStorage)
	}

	// Promos — Phase 3 kupon diskon (validate + redeem saat purchase/renew).
	// Admin CRUD di /admin/promos, user validate di /promos/validate.
	promosRepo := promos.NewRepo(pool)
	promosSvc := promos.NewService(promosRepo)
	promosHandler := promos.NewHandler(promosRepo, promosSvc)

	// Payment gateway registry — instansiasi Gateway concrete dari
	// payment_methods.config JSONB. Konsumer (invoices, domain_purchase)
	// call `gwRegistry.Get(ctx, "midtrans")` untuk build fresh Gateway.
	gwRegistry := paymentgw.NewRegistry(paymentsRepo)
	_ = gwRegistry // used by future domain_purchase refactor + webhook receiver

	// Invoices — Phase 1 self-sufficient invoice state machine + PDF renderer.
	invoicesRepo := invoices.NewRepo(pool)
	invoicesSvc := invoices.NewService(invoicesRepo, settingsSvc)
	invoicesHandler := invoices.NewHandler(invoicesRepo, invoicesSvc)
	invoicesHandler.SetPDFRenderer(invoices.NewHTMLRenderer(settingsSvc))
	// Wire assignment resolver — reseller repo implements ListManagedClientIDs
	// via interface (nil-safe kalau reseller feature disabled).
	invoicesHandler.SetAssignments(resellerRepo)

	// Payment webhook receiver — /webhooks/payment/:code dispatch ke
	// gwRegistry + invoicesSvc.MarkPaid. Downstream trigger:
	// ExecuteAfterPayment → EPP register/renew via api-registry (Fase 1c).
	paymentWebhookHandler := paymentwh.NewHandler(gwRegistry, invoicesSvc, invoicesRepo)
	if purchaseHandler != nil {
		// Wire callback: invoice paid → domain_purchase execute EPP.
		// Skip kalau purchaseHandler nil (registrar client tidak configured).
		paymentWebhookHandler.SetPaidCallback(purchaseHandler.ExecuteAfterPayment)
		slog.Info("payment webhook: callback wired ke domain_purchase.ExecuteAfterPayment")

		// Admin manual mark-paid (/admin/invoices/:id/mark-paid) juga harus
		// trigger downstream provisioning — kalau tidak, invoice paid tapi
		// purchase status tetap pending_payment (bug: user lihat status stuck
		// walau admin sudah verify bank transfer).
		invoicesHandler.SetPaidCallback(purchaseHandler.ExecuteAfterPayment)
		slog.Info("invoices: admin mark-paid callback wired ke domain_purchase.ExecuteAfterPayment")

		// PurchaseV2 dependencies — inject via adapters. Bikin 2-phase flow
		// (invoice + charge lokal) available di POST /domains/purchase.
		purchaseHandler.SetPricing(pricingAdapter{repo: pricingRepo, authRepo: authRepo})
		purchaseHandler.SetInvoices(invoicesAdapter{svc: invoicesSvc, repo: invoicesRepo})
		purchaseHandler.SetGatewayRegistry(gatewayRegistryAdapter{reg: gwRegistry})
		purchaseHandler.SetPromos(promosAdapter{svc: promosSvc})

		// Inject wallet debiter ke gateway registry supaya `deposit_wallet`
		// gateway tersedia untuk PurchaseV2 flow. WalletGateway sync-debit
		// balance saat CreateCharge; PurchaseV2 detect Type()=="wallet" +
		// trigger MarkPaid + ExecuteAfterPayment synchronous (no webhook wait).
		gwRegistry.SetWalletDebiter(walletDebiterAdapter{repo: walletLocalRepo})

		// Topup callback — ExecuteAfterPayment dispatch invoice.kind=topup
		// ke wallet_local.MarkTopupCredited. Credit ledger + update topup
		// row atomically dalam 1 SQL tx (race-safe kalau webhook retry).
		purchaseHandler.SetOnTopupPaid(func(ctx context.Context, inv *invoices.Invoice) error {
			topup, err := walletLocalRepo.GetTopupByInvoice(ctx, inv.ID)
			if err != nil {
				slog.Error("topup callback: fetch topup by invoice failed",
					"invoice_id", inv.ID, "error", err)
				return err
			}
			_, _, err = walletLocalRepo.MarkTopupCredited(ctx, topup.ID)
			if err != nil {
				slog.Error("topup callback: mark credited failed",
					"topup_id", topup.ID, "error", err)
				return err
			}
			slog.Info("topup: credited via webhook",
				"topup_id", topup.ID, "user_id", topup.UserID, "amount", topup.Amount)
			return nil
		})
	}

	// Wire wallet_local topup dependencies (invoice + gateway + user profile).
	// Terpisah dari `if purchaseHandler != nil` supaya topup handler tetap
	// aktif walaupun purchaseHandler nil (edge case: api-registry disabled
	// tapi wallet masih bisa top-up untuk store balance ke depan).
	walletLocalHandler.SetInvoicesService(walletInvoicesAdapter{svc: invoicesSvc})
	walletLocalHandler.SetGatewayRegistry(walletGatewayAdapter{reg: gwRegistry})
	walletLocalHandler.SetUserProfile(walletUserAdapter{repo: authRepo})
	// Storage — untuk upload bukti transfer manual_bank. Nil-safe kalau
	// storage init gagal (handler return 503).
	if assetStorage != nil {
		walletLocalHandler.SetStorage(assetStorage)
	}

	// Contact syncer — REMOVED (Fase 1 self-sufficient cleanup).
	// Removed: profile update propagation via
	// UpdateResellerContactByID/UpdateResellerDomainContact.
	// Alasan hapus: contactsync belum di-migrate ke api-registry contact
	// endpoints (contact routing di-defer per plan-phase-1). Kalau butuh,
	// implement ulang pakai registrar.RegisterDomainDirect flow atau via
	// UpdateDomainContact via api-registry.
	//
	// authHandler + resellerHandler tetap nil-safe: `SetContactSyncer(nil)`
	// = no propagation, profile update tetap tersimpan di web builder DB.

	// BYO .id domain handler — enabled only when the registrar client (for
	// WHOIS) is available. The priority-aware factory routes between
	// cloudflare/dnscloud based on admin config + user override + sticky
	// per-row config_id.
	dnsProvidersRepo := dns_providers.NewRepo(pool)
	dnsProviderFactory := dns_providers.NewFactory(dnsProvidersRepo).AsFactoryFn()
	dnsProvidersHandler := dns_providers.NewHandler(dnsProvidersRepo)

	// Wire factory into purchase handler too — tryAttachToDNS reads it to
	// pick the right backend (CF or DNSCloud) when a new domain is bought.
	// Also wire raw config reader so AdminDNSCloudInfo can fetch zone health
	// via DNSCloud API with the sticky token.
	if purchaseHandler != nil {
		purchaseHandler.SetProviderFactory(dnsProviderFactory)
		purchaseHandler.SetDNSProvidersRepo(dnsProvidersAdapter{repo: dnsProvidersRepo})
	}

	var byoHandler *site_byo_domains.Handler
	if registrarClient != nil {
		byoHandler = site_byo_domains.NewHandler(site_byo_domains.HandlerDeps{
			Repo:            byoRepo,
			Sites:           siteRepo,
			Purchases:       purchaseRepo,
			Registrar:       registrarClient,
			ProviderFactory: dnsProviderFactory,
			PlatformIPs:     cfg.PlatformIPs,
		})
		slog.Info("site_byo_domains: enabled")

		// Reconciler goroutine: health check NS + WHOIS refresh + 90d cleanup.
		// Tick 24h, zero config = sensible defaults (drift 7d / disconnect 30d
		// / cleanup 90d). Fires BYO lifecycle emails via `mailer`.
		byoReconciler := notifier.NewBYOReconciler(notifier.BYOReconcilerDeps{
			Repo:            byoRepo,
			Sites:           siteRepo,
			Auth:            authRepo,
			Whois:           registrarClient,
			ProviderFactory: dnsProviderFactory,
			Mailer:          mailer,
			Config:          notifier.BYOConfig{AppBaseURL: cfg.AppBaseURL},
		})
		go byoReconciler.Run(ctx)
	} else {
		slog.Info("site_byo_domains: disabled (registrar client required for WHOIS)")
	}

	deps := router.Deps{
		Cfg:            cfg,
		Pool:           pool,
		Issuer:         issuer,
		Auth:           authHandler,
		AuthGoogle:     googleHandler,
		Registrar:      registrarClient,
		DomainPurchase: purchaseHandler,
		Sites:          sitesHandler,
		SitesRepo:      siteRepo,
		Pages:          pagesHandler,
		Domains:        domains.NewHandler(domainRepo, siteRepo, cfg.PlatformIPs),
		Templates:      templatesHandler,
		Export: exports.NewHandler(&exports.Builder{
			Sites:    siteRepo,
			Pages:    pageRepo,
			Products: productRepo,
			Blog:     blogRepo,

			StoragePublicURL: storagePublicURL(cfg),
		}),
		Usage:            usage.NewHandler(usageRepo, siteRepo),
		Caddy:            caddy.NewHandler(domainRepo, cfg.RendererDefaultHost, cfg.PublicAppHost, cfg.PublicAPIHost, cfg.CaddyAskSecret),
		Public:           publicHandler,
		Admin:            adminHandler,
		Cloudflare:       cloudflare.NewHandler(cloudflareRepo),
		DNSProviders:     dnsProvidersHandler,
		Forms:            forms.NewHandler(formsRepo, siteRepo, mailer),
		Analytics:        analytics.NewHandler(analyticsRepo, siteRepo),
		Products:         products.NewHandler(productRepo, siteRepo),
		Blog:             blog.NewHandler(blogRepo, siteRepo),
		Snippets:         snippets.NewHandler(snippetRepo),
		Reseller:         resellerHandler,
		Audit:            auditHandler,
		EmailLog:         emailLogHandler,
		Pricing:          pricingHandler,
		Zones:            zonesHandler,
		Settings:         settingsHandler,
		Payments:         paymentsHandler,
		Invoices:         invoicesHandler,
		PaymentWebhook:   paymentWebhookHandler,
		WalletLocal:      walletLocalHandler,
		Documents:        documentsHandler,
		Promos:           promosHandler,
		SiteBYODomains:   byoHandler,
		PlatformArticles: platform_articles.NewHandler(platformArticlesRepo),
		AssetStorage:     assetStorage,
		ErrorTracker:     tracker,
	}

	// Seed platform articles kalau kosong (fire-and-forget, safe: idempotent).
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := platform_articles.SeedIfEmpty(bgCtx, platformArticlesRepo); err != nil {
			slog.Warn("platform_articles seed failed", "error", err)
		}
	}()
	if assetStorage != nil {
		deps.Assets = assets.NewHandler(assetRepo, assetStorage, siteRepo, assets.HandlerOptions{
			Compress:     cfg.ImageCompressEnabled,
			MaxDimension: cfg.ImageMaxDimension,
			JPEGQuality:  cfg.ImageJPEGQuality,
		})
	}

	// Scheduled publish worker — scan pages tabel tiap 60 detik untuk auto
	// publish draft yang scheduled_publish_at-nya sudah lewat. Interval hemat
	// DB (partial index) tapi tetap responsive (rata-rata delay 30s dari jadwal).
	scheduler := pages.NewScheduler(pageRepo, 60*time.Second)
	scheduler.SetPurger(purger)
	go scheduler.Run(ctx)

	app := router.New(deps)

	go func() {
		slog.Info("http listening", "addr", cfg.HTTPAddr, "env", cfg.AppEnv)
		if err := app.Listen(cfg.HTTPAddr); err != nil {
			slog.Error("listen failed", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	slog.Info("shutdown: stop signal received — draining")

	// Drain in-flight requests within a bounded window so a runaway handler
	// can't hold up the process indefinitely.
	shutdownCtx, c2 := context.WithTimeout(context.Background(), 25*time.Second)
	defer c2()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		slog.Error("shutdown: http server", "error", err)
	}
	// Cancel background goroutines (verify email, password reset dispatchers).
	cancel()
	slog.Info("shutdown: complete")
}

// resellerStatsAdapter — adapter type supaya reseller.Handler bisa panggil
// domain_purchase.Repo.GetResellerStats tanpa import cycle. Konversi
// *domain_purchase.ResellerStats → *reseller.DomainStats (shape identik,
// nama sengaja beda untuk cegah leak concrete type di interface).
type resellerStatsAdapter struct{ repo *domain_purchase.Repo }

func (a resellerStatsAdapter) GetResellerStats(ctx context.Context, actorIDs []uuid.UUID) (*reseller.DomainStats, error) {
	s, err := a.repo.GetResellerStats(ctx, actorIDs)
	if err != nil || s == nil {
		return nil, err
	}
	return &reseller.DomainStats{
		ActiveDomains:  s.ActiveDomains,
		Expiring30Days: s.Expiring30Days,
		Expiring90Days: s.Expiring90Days,
		PendingJobs:    s.PendingJobs,
	}, nil
}

// ListByPurchaser — adapter untuk agent detail page (list domain yang
// agent daftarkan). Konversi domain_purchase.Purchase → reseller.PurchaseSummary.
func (a resellerStatsAdapter) ListByPurchaser(ctx context.Context, purchaserID uuid.UUID, limit int) ([]reseller.PurchaseSummary, error) {
	rows, err := a.repo.ListByPurchaser(ctx, purchaserID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]reseller.PurchaseSummary, 0, len(rows))
	for _, p := range rows {
		out = append(out, reseller.PurchaseSummary{
			JobID:      p.RegistrarJobID,
			Domain:     p.Domain,
			Status:     p.Status,
			Kind:       p.Kind,
			Years:      p.Years,
			ExpiresAt:  p.ExpiresAt,
			CreatedAt:  p.CreatedAt,
			UserID:     p.UserID,
			PaymentURL: p.PaymentURL,
		})
	}
	return out, nil
}

// storagePublicURL mengembalikan URL publik driver storage yang aktif. Exporter
// memakainya untuk meng-allowlist host storage: guard SSRF-nya memblokir alamat
// privat, sedangkan MinIO/uploads lokal memang beralamat internal.
func storagePublicURL(cfg config.Config) string {
	if cfg.StorageDriver == "s3" {
		return cfg.StorageS3PublicURL
	}
	return cfg.StorageLocalPublicURL
}

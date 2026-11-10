package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv              string
	LogLevel            string
	HTTPAddr            string
	DatabaseURL         string
	JWTSecret           string
	JWTAccessTTL        time.Duration
	JWTRefreshTTL       time.Duration
	CaddyAskSecret      string
	PublicAppHost       string
	PublicAPIHost       string
	RendererDefaultHost string
	CORSOrigins         []string

	// PlatformIPs is the IPv4 allowlist used by domain verification. A custom
	// domain is considered "verified" only when its DNS A record resolves to
	// one of these IPs. Empty = dev mode (any resolution counts; INSECURE).
	PlatformIPs []string

	// Admin bootstrap — if set, server upserts this user with role=admin on startup.
	AdminEmail    string
	AdminPassword string
	AdminName     string

	// Demo seed — when true, insert demo user + site + sample products/posts on startup.
	SeedDemo         bool
	SeedDemoEmail    string
	SeedDemoPassword string

	StorageDriver string

	// S3 / MinIO
	StorageS3Endpoint  string
	StorageS3AccessKey string
	StorageS3SecretKey string
	StorageS3Region    string
	StorageS3Bucket    string
	StorageS3UseSSL    bool
	StorageS3PublicURL string

	// Local
	StorageLocalDir       string
	StorageLocalPublicURL string

	// DB pool tuning.
	DBMaxConns           int
	DBMinConns           int
	DBMaxConnLifetime    time.Duration
	DBMaxConnIdleTime    time.Duration
	DBSlowQueryThreshold time.Duration

	// PprofEnabled mounts /debug/pprof when true. Always behind admin role.
	PprofEnabled bool

	// RateLimitDisabled — kalau true, semua rate limit middleware pass-through
	// (RateLimitIP/RateLimitUser di router jadi no-op). Default false.
	// Dipakai saat development, load test, atau debug cepat "kena 429".
	// JANGAN aktifkan di production — kecuali ada WAF/CDN di depan yang
	// handle rate limiting sendiri.
	RateLimitDisabled bool

	// TrustProxy — set true kalau API di-deploy behind Caddy/Nginx reverse
	// proxy yang menambahkan X-Forwarded-For. Efek: Fiber c.IP() akan resolve
	// dari header proxy (bukan connecting IP yang selalu localhost). Wajib
	// untuk: rate limiter per-IP, view dedupe fingerprint, audit log IP.
	// JANGAN aktifkan kalau API expose langsung ke internet — attacker bisa
	// spoof X-Forwarded-For.
	TrustProxy bool

	// Image upload compression. Defaults: enabled, 2000px longest edge,
	// JPEG quality 82.
	ImageCompressEnabled bool
	ImageMaxDimension    int
	ImageJPEGQuality     int

	// Mail driver: "log" (dev — prints to stdout) or "smtp" (production).
	// Used by password reset + email verification flows.
	MailDriver   string
	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string // e.g. "Web Builder <no-reply@example.com>"
	SMTPStartTLS bool

	// AppBaseURL is the public URL of the dashboard (apps/web), used to build
	// password-reset and email-verify links sent to users.
	AppBaseURL string

	// SentryDSN enables error tracking when set; empty = disabled.
	SentryDSN string

	// Google OAuth — all three required together to enable "Login with Google".
	// If any is empty the /auth/google/* routes 503 with a clear "not configured"
	// message so the frontend can hide the button gracefully.
	GoogleOAuthClientID     string
	GoogleOAuthClientSecret string
	GoogleOAuthRedirectURL  string

	// e.id SSO. Client id + secret from the e.id developer dashboard; empty =
	// disabled. The callback URL is derived (EIDCallbackURL), not an env.
	EIDOAuthClientID     string
	EIDOAuthClientSecret string
	EIDAPIBase           string

	// --- api-registry (EPP service) ---
	//
	// APIRegistryURL wajib untuk enable domain flow (check/register/renew/
	// nameserver/contact/whois). Empty = domain feature disabled.
	APIRegistryURL        string
	APIRegistryHMACSecret string        // must match api-registry INTERNAL_HMAC_SECRET
	APIRegistryTimeout    time.Duration // default 30s
}

func Load() Config {
	return Config{
		AppEnv:              env("APP_ENV", "development"),
		LogLevel:            env("LOG_LEVEL", "info"),
		HTTPAddr:            env("HTTP_ADDR", ":8080"),
		DatabaseURL:         env("DATABASE_URL", "postgres://webbuilder:webbuilder@localhost:5432/webbuilder?sslmode=disable"),
		JWTSecret:           env("JWT_SECRET", "dev-secret-change-me"),
		JWTAccessTTL:        envDuration("JWT_ACCESS_TTL", 15*time.Minute),
		JWTRefreshTTL:       envDuration("JWT_REFRESH_TTL", 7*24*time.Hour),
		CaddyAskSecret:      env("CADDY_ASK_SECRET", "dev-caddy-secret"),
		PublicAppHost:       env("PUBLIC_APP_HOST", "app.localhost"),
		PublicAPIHost:       env("PUBLIC_API_HOST", "api.localhost"),
		RendererDefaultHost: env("RENDERER_DEFAULT_HOST", "localhost"),
		CORSOrigins:         splitCSV(env("CORS_ORIGINS", "http://localhost:3000,http://app.localhost")),
		PlatformIPs:         splitCSV(env("PLATFORM_IPS", "")),

		AdminEmail:    env("ADMIN_EMAIL", ""),
		AdminPassword: env("ADMIN_PASSWORD", ""),
		AdminName:     env("ADMIN_NAME", "Administrator"),

		SeedDemo:         env("SEED_DEMO", "false") == "true",
		SeedDemoEmail:    env("SEED_DEMO_EMAIL", "demo@example.com"),
		SeedDemoPassword: env("SEED_DEMO_PASSWORD", "demo1234"),

		StorageDriver: env("STORAGE_DRIVER", "local"),

		StorageS3Endpoint:  env("STORAGE_S3_ENDPOINT", "minio:9000"),
		StorageS3AccessKey: env("STORAGE_S3_ACCESS_KEY", "minioadmin"),
		StorageS3SecretKey: env("STORAGE_S3_SECRET_KEY", "minioadmin"),
		StorageS3Region:    env("STORAGE_S3_REGION", "us-east-1"),
		StorageS3Bucket:    env("STORAGE_S3_BUCKET", "assets"),
		StorageS3UseSSL:    env("STORAGE_S3_USE_SSL", "false") == "true",
		StorageS3PublicURL: env("STORAGE_S3_PUBLIC_URL", "http://localhost:9000/assets"),

		StorageLocalDir:       env("STORAGE_LOCAL_DIR", "./uploads"),
		StorageLocalPublicURL: env("STORAGE_LOCAL_PUBLIC_URL", "http://api.localhost/uploads"),

		MailDriver:   env("MAIL_DRIVER", "log"),
		SMTPHost:     env("SMTP_HOST", ""),
		SMTPPort:     envInt("SMTP_PORT", 587),
		SMTPUsername: env("SMTP_USERNAME", ""),
		SMTPPassword: env("SMTP_PASSWORD", ""),
		SMTPFrom:     env("SMTP_FROM", ""),
		SMTPStartTLS: env("SMTP_STARTTLS", "true") == "true",

		AppBaseURL: env("APP_BASE_URL", "http://app.localhost"),

		SentryDSN: env("SENTRY_DSN", ""),

		GoogleOAuthClientID:     env("GOOGLE_OAUTH_CLIENT_ID", ""),
		GoogleOAuthClientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET", ""),
		GoogleOAuthRedirectURL:  env("GOOGLE_OAUTH_REDIRECT_URL", ""),

		EIDOAuthClientID:     env("EID_OAUTH_CLIENT_ID", ""),
		EIDOAuthClientSecret: env("EID_OAUTH_CLIENT_SECRET", ""),
		EIDAPIBase:           env("EID_API_BASE", "https://api-wallet.e.id"),

		APIRegistryURL:        env("API_REGISTRY_URL", ""),
		APIRegistryHMACSecret: env("API_REGISTRY_HMAC_SECRET", ""),
		APIRegistryTimeout:    envDuration("API_REGISTRY_TIMEOUT", 30*time.Second),

		DBMaxConns:           envInt("DB_MAX_CONNS", 10),
		DBMinConns:           envInt("DB_MIN_CONNS", 2),
		DBMaxConnLifetime:    envDuration("DB_MAX_CONN_LIFETIME", time.Hour),
		DBMaxConnIdleTime:    envDuration("DB_MAX_CONN_IDLE_TIME", 15*time.Minute),
		DBSlowQueryThreshold: envDuration("DB_SLOW_QUERY_THRESHOLD", 500*time.Millisecond),

		PprofEnabled:      env("PPROF_ENABLED", "false") == "true",
		RateLimitDisabled: env("RATE_LIMIT_DISABLED", "false") == "true",
		TrustProxy:        env("TRUST_PROXY", "false") == "true",

		ImageCompressEnabled: env("IMAGE_COMPRESS_ENABLED", "true") == "true",
		ImageMaxDimension:    envInt("IMAGE_MAX_DIMENSION", 2000),
		ImageJPEGQuality:     envInt("IMAGE_JPEG_QUALITY", 82),
	}
}

// Validate enforces production safety rules.
// In production (APP_ENV=production) we refuse to boot with default secrets,
// weak secrets, or missing critical env that would otherwise silently fall back
// to insecure dev defaults.
func (c Config) Validate() error {
	if c.AppEnv != "production" {
		return nil
	}
	var errs []string

	// JWT secret: refuse to boot with default or short secret.
	if c.JWTSecret == "" || c.JWTSecret == "dev-secret-change-me" ||
		c.JWTSecret == "change-me-in-production-please" {
		errs = append(errs, "JWT_SECRET still uses default value (unsafe in production)")
	}
	if len(c.JWTSecret) < 32 {
		errs = append(errs, fmt.Sprintf("JWT_SECRET too short (%d bytes); use ≥32 random bytes", len(c.JWTSecret)))
	}

	// Caddy ask secret: required for on-demand TLS abuse prevention.
	if c.CaddyAskSecret == "" || c.CaddyAskSecret == "dev-caddy-secret" {
		errs = append(errs, "CADDY_ASK_SECRET still uses default value")
	}

	// Platform IPs: required so domain verification can compare DNS A records.
	if len(c.PlatformIPs) == 0 {
		errs = append(errs, "PLATFORM_IPS not set — domain verification would accept any DNS resolution (insecure)")
	}

	// Storage S3 secret keys must not be default in production.
	if c.StorageDriver == "s3" {
		if c.StorageS3SecretKey == "" || c.StorageS3SecretKey == "minioadmin" {
			errs = append(errs, "STORAGE_S3_SECRET_KEY still uses default ('minioadmin')")
		}
	}

	// Admin bootstrap warning (not fatal): if admin password is the default,
	// flag it loudly so operator notices.
	if c.AdminPassword == "changeme1234" {
		errs = append(errs, "ADMIN_PASSWORD still uses default ('changeme1234')")
	}

	// Database: refuse plaintext connections in production. sslmode=disable is
	// the most common footgun — a Postgres running over public network without
	// TLS is a data-exfil risk. EXCEPTION: kalau connect via loopback
	// (localhost / 127.0.0.1 / ::1) atau unix socket, traffic tidak keluar
	// dari mesin — TLS tidak menambah keamanan. Common deployment pattern:
	// API + Postgres di 1 VPS.
	if strings.Contains(c.DatabaseURL, "sslmode=disable") && !isLoopbackDSN(c.DatabaseURL) {
		errs = append(errs, "DATABASE_URL uses sslmode=disable (TLS required in production; loopback host OK)")
	}

	// CORS: must be explicit, no localhost.
	if len(c.CORSOrigins) == 0 {
		errs = append(errs, "CORS_ORIGINS empty (would block browsers in production)")
	}
	for _, o := range c.CORSOrigins {
		if strings.Contains(o, "localhost") || strings.Contains(o, "127.0.0.1") {
			errs = append(errs,
				fmt.Sprintf("CORS_ORIGINS contains dev value %q (production should list public origins only)", o))
		}
	}

	// Public hosts: catch operator forgetting to update PUBLIC_*_HOST from
	// the dev defaults.
	if strings.HasSuffix(c.PublicAppHost, ".localhost") || c.PublicAppHost == "localhost" {
		errs = append(errs,
			fmt.Sprintf("PUBLIC_APP_HOST still dev value %q", c.PublicAppHost))
	}
	if strings.HasSuffix(c.PublicAPIHost, ".localhost") || c.PublicAPIHost == "localhost" {
		errs = append(errs,
			fmt.Sprintf("PUBLIC_API_HOST still dev value %q", c.PublicAPIHost))
	}

	// The browser is sent to these after Google sign-in and from emails; a
	// localhost value silently breaks login for every real user.
	if isLocalURL(c.AppBaseURL) {
		errs = append(errs, fmt.Sprintf("APP_BASE_URL still dev value %q", c.AppBaseURL))
	}
	if c.GoogleOAuthClientID != "" && (c.GoogleOAuthRedirectURL == "" || isLocalURL(c.GoogleOAuthRedirectURL)) {
		errs = append(errs, fmt.Sprintf("GOOGLE_OAUTH_REDIRECT_URL must be the public API callback URL, got %q", c.GoogleOAuthRedirectURL))
	}

	// SMTP: if mail driver is "smtp", host+from required.
	if c.MailDriver == "smtp" {
		if c.SMTPHost == "" || c.SMTPFrom == "" {
			errs = append(errs, "MAIL_DRIVER=smtp requires SMTP_HOST and SMTP_FROM")
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("config validation failed:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return nil
}

// EIDCallbackURL is the e.id OAuth callback — register exactly this URL in
// the e.id developer dashboard. The scheme follows APP_BASE_URL (http in dev).
func (c Config) EIDCallbackURL() string {
	scheme := "https"
	if strings.HasPrefix(c.AppBaseURL, "http://") {
		scheme = "http"
	}
	return scheme + "://" + c.PublicAPIHost + "/api/v1/auth/eid/callback"
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envDuration(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// isLoopbackDSN — return true kalau DATABASE_URL point ke localhost / 127.0.0.1
// / ::1 / unix socket. Dipakai relaxation validasi sslmode=disable — kalau
// koneksi tidak keluar dari mesin, TLS tidak menambah keamanan.
//
// Support 2 format:
//   - URL DSN: `postgres://user:pass@host:port/db?...`
//   - keyword=value: `host=localhost user=x dbname=y` atau `host=/var/run/postgresql ...`
//
// Fallback substring match untuk password yang mengandung `@` (bikin url.Parse
// misidentify host — mis. `postgres://u:p@ss@localhost:5432/x`).
func isLoopbackDSN(dsn string) bool {
	if dsn == "" {
		return false
	}
	// Unix socket via keyword=value DSN — path absolute (/var/run/postgresql).
	// Tidak lewat network sama sekali.
	if strings.Contains(dsn, "host=/") {
		return true
	}
	// keyword=value DSN dengan host loopback.
	for _, kv := range []string{"host=localhost", "host=127.0.0.1", "host=::1"} {
		if strings.Contains(dsn, kv) {
			return true
		}
	}
	// URL DSN — parse host component (path yang paling common).
	if u, err := url.Parse(dsn); err == nil && u.Host != "" {
		host := u.Hostname()
		switch host {
		case "localhost", "127.0.0.1", "::1", "":
			return true
		}
	}
	// Fallback substring match — cover URL DSN dengan password yang mengandung
	// karakter khusus (@, :) yang bikin url.Parse hasil host salah. Cukup
	// permissive tapi acceptable karena guard di production build:
	// admin ops harus explicit set sslmode=disable → ini opt-in.
	if strings.Contains(dsn, "@localhost:") ||
		strings.Contains(dsn, "@localhost/") ||
		strings.Contains(dsn, "@127.0.0.1:") ||
		strings.Contains(dsn, "@127.0.0.1/") ||
		strings.Contains(dsn, "@[::1]:") ||
		strings.Contains(dsn, "@[::1]/") {
		return true
	}
	return false
}

func isLocalURL(s string) bool {
	return s == "" || strings.Contains(s, "localhost") || strings.Contains(s, "127.0.0.1")
}

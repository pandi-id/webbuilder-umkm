// Package config load environment variables + expose typed config struct.
// Follows same pattern as apps/api/internal/config supaya operator familiar.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config — full runtime config. Semua load dari environment (12-factor).
// Panic di Load kalau field mandatory kosong — fail fast di startup.
type Config struct {
	// HTTP server
	Port     string
	AppEnv   string // "dev" | "staging" | "prod"
	LogLevel string // "debug" | "info" | "warn" | "error"

	// Provider mode — decide implementation:
	//   `pandi_wrapper` : proxy ke registrar-api PANDI (Fase 1a — MVP).
	//   `epp_direct`    : native EPP client via teknispandi/epp-pandi-client (Fase 1b).
	ProviderMode string // "pandi_wrapper" | "epp_direct"

	// PANDI wrapper config (kalau ProviderMode=pandi_wrapper)
	PandiAPIURL      string
	PandiAPIKey      string        // JWT statis (opsional kalau pakai email/pass)
	PandiEmail       string        // untuk auto-login + refresh
	PandiPassword    string
	PandiAPITimeout  time.Duration

	// EPP direct config (kalau ProviderMode=epp_direct).
	// Cocok untuk PANDI EPP OT&E: epp1.pandi.id:700, epp2.pandi.id:700.
	EPPHost               string
	EPPPort               int
	EPPUser               string
	EPPPassword           string
	EPPCertFile           string        // client TLS certificate path
	EPPKeyFile            string        // client TLS private key path
	EPPCAFile             string        // registry CA cert (opsional; verify server)
	EPPInsecureSkipVerify bool          // dev/OT&E dengan self-signed cert — jangan pakai di prod
	EPPKeepAliveInterval  time.Duration // hello frame interval (default 5min)
	// EPPPerCommandSession — kalau true, connect+login+logout per-command
	// (no session reuse). Berguna untuk registry yang session-cap ketat atau
	// debug supaya XML log 1 command 1 session. Default false (session reuse).
	EPPPerCommandSession bool
	// EPPLogFile — path ke file untuk dump verbose log EPP client (include
	// XML request/response). Kosong = no file logging, cuma stdout. Kalau
	// set, log ditulis dengan format console (human-readable) di level Debug.
	EPPLogFile string

	// EPPDebugXML — kalau true, api-registry dump request frame (marshaled)
	// + response raw ke slog default handler per EPP command. WARNING: XML
	// bisa mengandung credential (login) + PII (contact create/update) +
	// authInfo. HANYA aktifkan sementara untuk debug di dev/staging. Default
	// false untuk prod.
	EPPDebugXML bool

	// Security — auth header dari web builder API.
	// HMAC shared secret — request body di-sign, verify di-server. Simple + no
	// PKI overhead untuk phase awal. Kalau butuh stronger, migrate ke mTLS.
	InternalHMACSecret string

	// Rate limit + timeouts
	RequestTimeout time.Duration
	MaxConcurrent  int // limit inflight EPP call (registry biasanya cap session)
	// Per-source IP rate limit sebagai defense-in-depth di atas HMAC.
	// Cegah bulk request kalau secret bocor / port accidental exposure.
	RateLimitPerIP int           // req per window per IP (default 300)
	RateLimitWindow time.Duration // window default 60s

	// --- Webhook relay ---
	// Upstream secret: verify webhook dari registrar-api (HMAC SHA-256 dari body).
	WebhookUpstreamSecret string
	// Forward config: kalau URL kosong, api-registry cuma verify + audit,
	// tidak forward. Cocok untuk staging tanpa web builder yang match.
	WebbuilderWebhookURL    string
	WebbuilderWebhookSecret string
	WebhookForwardTimeout   time.Duration

	// --- Resilience (retry + circuit breaker) ---
	// Default enabled di production untuk lindungi dari upstream cascading
	// failure. Disable kalau butuh raw upstream behavior untuk debug.
	ResilienceEnabled       bool
	RetryMaxAttempts        int
	RetryInitialDelay       time.Duration
	RetryMaxDelay           time.Duration
	CircuitFailureThreshold int
	CircuitCooldownPeriod   time.Duration
}

// Load reads config from env; defaults for optional fields. Panic kalau
// mandatory-nya kosong.
func Load() *Config {
	c := &Config{
		Port:     getEnv("PORT", "5000"),
		AppEnv:   getEnv("APP_ENV", "dev"),
		LogLevel: getEnv("LOG_LEVEL", "info"),

		ProviderMode: getEnv("PROVIDER_MODE", "epp_direct"),

		PandiAPIURL:     getEnv("PANDI_API_URL", ""),
		PandiAPIKey:     getEnv("PANDI_API_KEY", ""),
		PandiEmail:      getEnv("PANDI_EMAIL", ""),
		PandiPassword:   getEnv("PANDI_PASSWORD", ""),
		PandiAPITimeout: getDuration("PANDI_API_TIMEOUT", 15*time.Second),

		EPPHost:     getEnv("EPP_HOST", ""),
		EPPPort:     getInt("EPP_PORT", 700),
		EPPUser:     getEnv("EPP_USER", ""),
		EPPPassword: getEnv("EPP_PASSWORD", ""),
		EPPCertFile:           getEnv("EPP_CERT_FILE", ""),
		EPPKeyFile:            getEnv("EPP_KEY_FILE", ""),
		EPPCAFile:             getEnv("EPP_CA_FILE", ""),
		EPPInsecureSkipVerify: getBool("EPP_INSECURE_SKIP_VERIFY", false),
		EPPKeepAliveInterval:  getDuration("EPP_KEEPALIVE_INTERVAL", 5*time.Minute),
		EPPPerCommandSession:  getBool("EPP_PER_COMMAND_SESSION", false),
		EPPLogFile:            getEnv("EPP_LOG_FILE", ""),
		EPPDebugXML:           getBool("EPP_DEBUG_XML", false),

		InternalHMACSecret: getEnv("INTERNAL_HMAC_SECRET", ""),

		RequestTimeout: getDuration("REQUEST_TIMEOUT", 30*time.Second),
		MaxConcurrent:   getInt("MAX_CONCURRENT", 20),
		RateLimitPerIP:  getInt("RATE_LIMIT_PER_IP", 300),
		RateLimitWindow: getDuration("RATE_LIMIT_WINDOW", 60*time.Second),

		WebhookUpstreamSecret:   getEnv("WEBHOOK_UPSTREAM_SECRET", ""),
		WebbuilderWebhookURL:    getEnv("WEBBUILDER_WEBHOOK_URL", ""),
		WebbuilderWebhookSecret: getEnv("WEBBUILDER_WEBHOOK_SECRET", ""),
		WebhookForwardTimeout:   getDuration("WEBHOOK_FORWARD_TIMEOUT", 10*time.Second),

		ResilienceEnabled:       getBool("RESILIENCE_ENABLED", true),
		RetryMaxAttempts:        getInt("RETRY_MAX_ATTEMPTS", 3),
		RetryInitialDelay:       getDuration("RETRY_INITIAL_DELAY", 200*time.Millisecond),
		RetryMaxDelay:           getDuration("RETRY_MAX_DELAY", 5*time.Second),
		CircuitFailureThreshold: getInt("CIRCUIT_FAILURE_THRESHOLD", 5),
		CircuitCooldownPeriod:   getDuration("CIRCUIT_COOLDOWN_PERIOD", 30*time.Second),
	}

	// Validate per provider mode. Wrapper butuh URL + credentials; EPP direct
	// butuh EPP host+user+password+cert. Fail fast dengan pesan jelas.
	if c.ProviderMode == "pandi_wrapper" {
		if c.PandiAPIURL == "" {
			panic("PANDI_API_URL wajib saat PROVIDER_MODE=pandi_wrapper")
		}
		if c.PandiAPIKey == "" && (c.PandiEmail == "" || c.PandiPassword == "") {
			panic("PANDI_API_KEY atau (PANDI_EMAIL + PANDI_PASSWORD) wajib saat PROVIDER_MODE=pandi_wrapper")
		}
	} else if c.ProviderMode == "epp_direct" {
		if c.EPPHost == "" || c.EPPUser == "" || c.EPPPassword == "" {
			panic("EPP_HOST + EPP_USER + EPP_PASSWORD wajib saat PROVIDER_MODE=epp_direct")
		}
	} else {
		panic(fmt.Sprintf("PROVIDER_MODE tidak dikenal: %q (harus pandi_wrapper atau epp_direct)", c.ProviderMode))
	}

	if c.InternalHMACSecret == "" {
		// Boleh kosong di dev; wajib di staging/prod.
		if c.AppEnv != "dev" {
			panic("INTERNAL_HMAC_SECRET wajib di staging/prod (protect internal API)")
		}
	}

	return c
}

// --- env helpers ---

func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getBool(key string, fallback bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "":
		return fallback
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

package router

import (
	"sync/atomic"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"

	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/httpx"
)

// rateLimitDisabled — toggle global untuk disable semua rate limit tanpa
// perlu hapus middleware di route. Dipakai saat debug "kena 429 tapi harus
// bisa test cepat" atau selama load test. Default false (rate limit aktif).
//
// Set via SetRateLimitDisabled(true) di startup (biasanya dari env var).
// Atomic supaya safe untuk read dari banyak request goroutine tanpa lock.
var rateLimitDisabled atomic.Bool

// SetRateLimitDisabled toggles global rate limit kill-switch. Dipanggil dari
// main.go setelah load config. True = semua RateLimitIP/RateLimitUser
// middleware pass-through (no gate).
func SetRateLimitDisabled(disabled bool) {
	rateLimitDisabled.Store(disabled)
}

// RateLimitEnabled reports current state (dipakai health check / debug).
func RateLimitEnabled() bool { return !rateLimitDisabled.Load() }

// Rate limit budgets — generous enough for legitimate use, tight enough to
// blunt credential stuffing / spam upload / API scraping.
//
// Storage: Fiber's default in-memory map. Fine for single-instance prod.
// For multi-instance, swap with gofiber/storage/redis (the Redis service is
// already in docker-compose).
const (
	// Auth endpoints — per-IP. Prevents brute force.
	loginPerWindow    = 10               // 10 attempts
	loginWindow       = 5 * time.Minute  // per 5 minutes per IP
	registerPerWindow = 5                // 5 signups
	registerWindow    = 60 * time.Minute // per hour per IP
	refreshPerWindow  = 60               // tokens rotate quickly when active
	refreshWindow    = 60 * time.Minute

	// Password recovery — keep tight; mail abuse + brute force on token reuse.
	passwordForgotPerWindow = 5
	passwordForgotWindow    = 60 * time.Minute
	passwordResetPerWindow  = 20
	passwordResetWindow     = 60 * time.Minute
	emailVerifyPerWindow    = 20
	emailVerifyWindow       = 60 * time.Minute
	emailResendPerWindow    = 5
	emailResendWindow       = 60 * time.Minute

	// Authenticated mutations — per-user.
	uploadPerWindow   = 60               // 60 uploads
	uploadWindow      = 60 * time.Minute // per hour per user
	mutationPerWindow = 300              // 300 writes
	mutationWindow    = 60 * time.Second // per minute per user (generous burst)

	// Money-moving ops (Phase 7) — tight per-user budgets untuk cegah spam
	// spending. Reseller yang legit tidak butuh > 20 purchase/jam; kalau butuh,
	// admin bisa raise via env override (out of scope MVP).
	purchasePerWindow    = 20               // 20 register/renew
	purchaseWindow       = 60 * time.Minute // per jam per user

	// Registrar webhook receiver — per-IP defence in depth. HMAC-authed sudah
	// filter payload valid, tapi tanpa rate-limit attacker bisa hammer endpoint
	// dengan payload garbage yang gagal verify (CPU cycle terpakai per request).
	// Generous karena registrar legit boleh burst callback (banyak job update
	// bersamaan setelah payment batch).
	webhookPerWindow = 600              // 600 hits
	webhookWindow    = 60 * time.Second // per menit per source IP

	// Public form submit — per-IP anti-spam. User asli submit paling banyak
	// 1x per form load, jadi 10/menit sudah generous. Kombinasi honeypot
	// field "_hp" di renderer sudah filter mayoritas bot dumb.
	formSubmitPerWindow = 10
	formSubmitWindow    = 60 * time.Second

	// Public analytics pageview beacon — per-IP high limit karena setiap
	// pageload trigger 1 hit. 200/menit = 3.3 view/detik per IP (bot spam
	// tetap kena; user asli tidak).
	analyticsPerWindow = 200
	analyticsWindow    = 60 * time.Second

	// Public checkout — per-IP. A real buyer places a handful of orders at
	// most; each one reserves stock, so keep spam from draining inventory.
	orderCreatePerWindow = 10
	orderCreateWindow    = 10 * time.Minute
)

// RateLimitIP keys by client IP. Use for unauthenticated endpoints (login,
// register, refresh, password reset, etc.) where there's no user identity yet.
//
// Kalau SetRateLimitDisabled(true) sudah dipanggil, middleware pass-through
// semua request (no gate) — tanpa perlu hapus limiter dari route definitions.
func RateLimitIP(max int, window time.Duration) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        max,
		Expiration: window,
		Next:       func(_ *fiber.Ctx) bool { return rateLimitDisabled.Load() },
		KeyGenerator: func(c *fiber.Ctx) string {
			// Prefer X-Forwarded-For first IP if behind trusted proxy (Caddy).
			if xff := c.Get("X-Forwarded-For"); xff != "" {
				return "ip:" + firstIP(xff)
			}
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return httpx.Err(c, fiber.StatusTooManyRequests, "rate_limited",
				"Terlalu banyak request. Coba lagi beberapa menit.")
		},
	})
}

// RateLimitUser keys by authenticated user ID, falling back to IP if claims
// not present (defense in depth — should not happen behind auth.Required).
// Use AFTER auth.Required middleware.
//
// Same kill-switch semantics as RateLimitIP via SetRateLimitDisabled.
func RateLimitUser(max int, window time.Duration) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        max,
		Expiration: window,
		Next:       func(_ *fiber.Ctx) bool { return rateLimitDisabled.Load() },
		KeyGenerator: func(c *fiber.Ctx) string {
			if cl := auth.ClaimsFrom(c); cl != nil {
				return "uid:" + cl.UserID.String()
			}
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return httpx.Err(c, fiber.StatusTooManyRequests, "rate_limited",
				"Terlalu banyak request. Mohon tunggu sebentar.")
		},
	})
}

func firstIP(xff string) string {
	for i := 0; i < len(xff); i++ {
		if xff[i] == ',' {
			return xff[:i]
		}
	}
	return xff
}

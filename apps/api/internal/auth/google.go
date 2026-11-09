package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/webbuilder/api/internal/httpx"
	"golang.org/x/oauth2"
	googleOAuth "golang.org/x/oauth2/google"
)

// GoogleHandler implements the "Login with Google" flow using the standard
// OAuth 2.0 Authorization Code exchange.
//
// Flow:
//  1. Browser → GET /api/v1/auth/google/authorize?next=/dashboard
//     → we set a short-lived, http-only state cookie (CSRF + `next` payload)
//     → 302 to Google consent screen.
//  2. Google → GET /api/v1/auth/google/callback?code=...&state=...
//     → verify state matches cookie, exchange code for tokens, fetch userinfo,
//       upsert user (link-by-email OR create), mint our JWT+refresh,
//       302 to ${WebBaseURL}/auth/callback#access_token=…&refresh_token=…
//  3. Browser JS at /auth/callback parses the URL fragment, setTokens(), replace().
//
// Design notes:
//   - Tokens travel in the URL fragment (not query) so they never hit server
//     logs of any intermediate hop.
//   - State cookie is http-only + SameSite=Lax so cross-site pages can't read
//     it but the browser still sends it on the top-level redirect from Google.
type GoogleHandler struct {
	repo       *Repo
	authH      *Handler
	oauthConf  *oauth2.Config
	webBaseURL string
	enabled    bool
}

// NewGoogleHandler builds the Google OAuth handler. All 3 config strings must
// be non-empty for it to be considered "enabled"; otherwise the routes 503 so
// the frontend can gracefully hide the Google button.
func NewGoogleHandler(repo *Repo, authH *Handler, clientID, clientSecret, redirectURL, webBaseURL string) *GoogleHandler {
	enabled := clientID != "" && clientSecret != "" && redirectURL != ""
	var conf *oauth2.Config
	if enabled {
		conf = &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Endpoint:     googleOAuth.Endpoint,
			Scopes:       []string{"openid", "email", "profile"},
		}
	}
	return &GoogleHandler{
		repo:       repo,
		authH:      authH,
		oauthConf:  conf,
		webBaseURL: strings.TrimRight(webBaseURL, "/"),
		enabled:    enabled,
	}
}

// Enabled reports whether Google login is configured.
func (h *GoogleHandler) Enabled() bool { return h.enabled }

const (
	googleStateCookie    = "wb_google_oauth_state"
	googleStateCookieTTL = 10 * time.Minute
	googleUserinfoURL    = "https://www.googleapis.com/oauth2/v3/userinfo"
)

// Authorize starts the OAuth flow. Optional `next` query param = same-origin
// path to land on after login (defaults to /dashboard). Anything with a scheme
// or "//" prefix is dropped to prevent open-redirect abuse.
func (h *GoogleHandler) Authorize(c *fiber.Ctx) error {
	if !h.enabled {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "google_not_configured",
			"Login Google belum dikonfigurasi di server.")
	}
	next := sanitizeNextPath(c.Query("next"))
	nonce, err := randomHex(16)
	if err != nil {
		return httpx.Internal(c, "state gen failed")
	}
	// State payload = nonce + next, joined with '.'. Google echoes back verbatim.
	state := nonce + "." + next

	c.Cookie(&fiber.Cookie{
		Name:     googleStateCookie,
		Value:    state,
		Path:     "/",
		HTTPOnly: true,
		Secure:   c.Protocol() == "https",
		SameSite: "Lax",
		MaxAge:   int(googleStateCookieTTL.Seconds()),
	})

	return c.Redirect(h.oauthConf.AuthCodeURL(state, oauth2.AccessTypeOnline), fiber.StatusFound)
}

// Callback handles Google's redirect. Any failure redirects to the web login
// page with ?error=<reason> so users see a friendly message.
func (h *GoogleHandler) Callback(c *fiber.Ctx) error {
	if !h.enabled {
		return httpx.Err(c, fiber.StatusServiceUnavailable, "google_not_configured",
			"Login Google belum dikonfigurasi di server.")
	}

	// User clicked "Cancel" on the consent screen.
	if e := c.Query("error"); e != "" {
		return h.redirectError(c, "/dashboard", "google_"+e)
	}

	state := c.Query("state")
	cookieState := c.Cookies(googleStateCookie)
	// Single-use — clear immediately whether it matched or not.
	c.Cookie(&fiber.Cookie{Name: googleStateCookie, Value: "", Path: "/", MaxAge: -1})
	if state == "" || cookieState == "" || state != cookieState {
		return h.redirectError(c, "/dashboard", "state_mismatch")
	}
	_, next, _ := strings.Cut(state, ".")
	next = sanitizeNextPath(next)

	code := c.Query("code")
	if code == "" {
		return h.redirectError(c, next, "no_code")
	}

	ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
	defer cancel()

	tok, err := h.oauthConf.Exchange(ctx, code)
	if err != nil {
		slog.Error("google oauth: exchange failed", "error", err)
		return h.redirectError(c, next, "exchange_failed")
	}

	profile, err := fetchGoogleProfile(ctx, h.oauthConf.Client(ctx, tok))
	if err != nil {
		slog.Error("google oauth: userinfo failed", "error", err)
		return h.redirectError(c, next, "profile_failed")
	}
	if profile.Sub == "" || profile.Email == "" {
		return h.redirectError(c, next, "profile_incomplete")
	}
	if !profile.EmailVerified {
		return h.redirectError(c, next, "email_unverified")
	}

	email := strings.ToLower(strings.TrimSpace(profile.Email))
	u, err := h.repo.UpsertGoogleUser(ctx, profile.Sub, email, strings.TrimSpace(profile.Name))
	if err != nil {
		slog.Error("google oauth: upsert user failed", "error", err)
		return h.redirectError(c, next, "user_upsert_failed")
	}

	access, refresh, err := h.authH.MintTokensFor(ctx, u)
	if err != nil {
		// A locked account is an expected outcome, not a server fault: surface
		// its own code so the login page can say why.
		var locked *LoginLockedError
		if errors.As(err, &locked) {
			return h.redirectError(c, next, locked.Code)
		}
		slog.Error("google oauth: token mint failed", "error", err)
		return h.redirectError(c, next, "token_failed")
	}

	fragment := url.Values{}
	fragment.Set("access_token", access)
	fragment.Set("refresh_token", refresh)
	fragment.Set("next", next)
	return c.Redirect(h.webBaseURL+"/auth/callback#"+fragment.Encode(), fiber.StatusFound)
}

func (h *GoogleHandler) redirectError(c *fiber.Ctx, next, code string) error {
	q := url.Values{}
	q.Set("error", code)
	if next != "" && next != "/dashboard" {
		q.Set("next", next)
	}
	return c.Redirect(h.webBaseURL+"/login?"+q.Encode(), fiber.StatusFound)
}

// sanitizeNextPath allows only same-origin absolute paths ("/dashboard", "/sites/…").
// Anything with a scheme, host, or "//" prefix is dropped (open-redirect defence).
func sanitizeNextPath(p string) string {
	if p == "" {
		return "/dashboard"
	}
	if strings.HasPrefix(p, "//") || strings.Contains(p, ":") || !strings.HasPrefix(p, "/") {
		return "/dashboard"
	}
	return p
}

// googleProfile is the subset of Google's userinfo response we care about.
type googleProfile struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
}

// fetchGoogleProfile calls the OpenID userinfo endpoint using the authenticated
// http.Client returned by oauth2.Config.Client(). Package-level var so tests
// can stub it without spinning up a real HTTP server.
var fetchGoogleProfile = func(ctx context.Context, client *http.Client) (*googleProfile, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleUserinfoURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo status %d", resp.StatusCode)
	}
	var p googleProfile
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, err
	}
	return &p, nil
}

// randomHex returns a URL-safe random hex string of `n` bytes (2n chars).
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

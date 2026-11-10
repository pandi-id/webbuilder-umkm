package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/webbuilder/api/internal/httpx"
)

// EIDHandler — "Masuk / Daftar dengan e.id" (https://docs.e.id/en/oauth-sso,
// API v1.1). Ported from the `website` repo; study notes in e-id.md. One flow
// covers login and sign-up, shaped like GoogleHandler:
//
//  1. Browser → GET /api/v1/auth/eid/authorize?next=/dashboard
//     → http-only state cookie (nonce + next) → 302 to e.id /oauth/verify.
//  2. e.id → GET /api/v1/auth/eid/callback?code=…
//     → get-token → get-profile → upsert user → mint our JWT
//     → 302 ${WebBaseURL}/auth/callback#access_token=…
//
// e.id is not OIDC: no state echo, no id_token, no permanent user ID, so
// accounts are matched by email. The cookie is then the only proof this
// browser started the login: it stops a bare link carrying someone else's
// code, but not a page that opens /authorize in the victim's browser first.
type EIDHandler struct {
	repo         *Repo
	authH        *Handler
	clientID     string
	clientSecret string
	apiBase      string
	callbackURL  string
	webBaseURL   string
	http         *http.Client
	enabled      bool
}

func NewEIDHandler(repo *Repo, authH *Handler, clientID, clientSecret, apiBase, callbackURL, webBaseURL string) *EIDHandler {
	return &EIDHandler{
		repo:         repo,
		authH:        authH,
		clientID:     clientID,
		clientSecret: clientSecret,
		apiBase:      strings.TrimRight(apiBase, "/"),
		callbackURL:  callbackURL,
		webBaseURL:   strings.TrimRight(webBaseURL, "/"),
		http:         &http.Client{Timeout: 10 * time.Second},
		enabled:      clientID != "" && clientSecret != "" && apiBase != "",
	}
}

func (h *EIDHandler) Enabled() bool { return h.enabled }

const (
	eidStateCookie    = "wb_eid_oauth_state"
	eidStateCookieTTL = 10 * time.Minute
)

// Authorize starts the flow. It is a browser navigation, so failures redirect
// to /login with a message instead of answering JSON.
func (h *EIDHandler) Authorize(c *fiber.Ctx) error {
	next := sanitizeNextPath(c.Query("next"))
	if !h.enabled {
		return h.redirectError(c, next, "eid_not_configured")
	}
	nonce, err := randomHex(16)
	if err != nil {
		return h.redirectError(c, next, "eid_failed")
	}
	c.Cookie(&fiber.Cookie{
		Name:     eidStateCookie,
		Value:    nonce + "." + next,
		Path:     "/",
		HTTPOnly: true,
		Secure:   c.Protocol() == "https",
		// Lax: still sent on the top-level redirect back from e.id.
		SameSite: "Lax",
		MaxAge:   int(eidStateCookieTTL.Seconds()),
	})
	q := url.Values{}
	q.Set("client_id", h.clientID)
	q.Set("callback_url", h.callbackURL)
	return c.Redirect(h.apiBase+"/api/v1.1/oauth/verify?"+q.Encode(), fiber.StatusFound)
}

func (h *EIDHandler) Callback(c *fiber.Ctx) error {
	cookieState := c.Cookies(eidStateCookie)
	// Single-use — clear whatever happens next.
	c.Cookie(&fiber.Cookie{Name: eidStateCookie, Value: "", Path: "/", MaxAge: -1})
	_, next, _ := strings.Cut(cookieState, ".")
	next = sanitizeNextPath(next)

	if !h.enabled {
		return h.redirectError(c, next, "eid_not_configured")
	}
	// No cookie = the callback did not start from this browser (or is older
	// than 10 minutes). Should e.id ever echo `state`, it must match too.
	if cookieState == "" {
		return h.redirectError(c, next, "eid_state_mismatch")
	}
	if s := c.Query("state"); s != "" && s != cookieState {
		return h.redirectError(c, next, "eid_state_mismatch")
	}
	code := c.Query("code")
	if c.Query("error") != "" || code == "" {
		return h.redirectError(c, next, "eid_cancelled")
	}

	ctx, cancel := context.WithTimeout(c.Context(), 20*time.Second)
	defer cancel()

	token, err := h.getToken(ctx, code)
	if err != nil {
		slog.Error("eid oauth: token exchange failed", "error", err)
		if strings.Contains(err.Error(), "OAUTH.INVALID_OR_EXPIRED_CODE") {
			return h.redirectError(c, next, "eid_code_expired")
		}
		return h.redirectError(c, next, "eid_exchange_failed")
	}
	raw, err := h.getProfile(ctx, token)
	if err != nil {
		slog.Error("eid oauth: get profile failed", "error", err)
		return h.redirectError(c, next, "eid_profile_failed")
	}
	profile := normalizeEIDProfile(raw)
	if profile.Email == "" {
		return h.redirectError(c, next, "eid_no_email")
	}

	u, err := h.repo.UpsertEIDUser(ctx, profile)
	if err != nil {
		if errors.Is(err, ErrEIDEmailUnverified) {
			return h.redirectError(c, next, "eid_email_unverified")
		}
		slog.Error("eid oauth: upsert user failed", "error", err)
		return h.redirectError(c, next, "eid_user_failed")
	}
	access, refresh, err := h.authH.MintTokensFor(ctx, u)
	if err != nil {
		// Suspended accounts and pending resellers are expected outcomes:
		// surface the gate's own code so the login page says why.
		var locked *LoginLockedError
		if errors.As(err, &locked) {
			return h.redirectError(c, next, locked.Code)
		}
		slog.Error("eid oauth: token mint failed", "error", err)
		return h.redirectError(c, next, "eid_failed")
	}
	fragment := url.Values{}
	fragment.Set("access_token", access)
	fragment.Set("refresh_token", refresh)
	fragment.Set("next", next)
	return c.Redirect(h.webBaseURL+"/auth/callback#"+fragment.Encode(), fiber.StatusFound)
}

func (h *EIDHandler) redirectError(c *fiber.Ctx, next, code string) error {
	q := url.Values{}
	q.Set("error", code)
	if next != "" && next != "/dashboard" {
		q.Set("next", next)
	}
	return c.Redirect(h.webBaseURL+"/login?"+q.Encode(), fiber.StatusFound)
}

// eidEnvelope — every e.id response: { status, message, data }. Error codes
// (e.g. OAUTH.INVALID_OR_EXPIRED_CODE) arrive in message.
type eidEnvelope[T any] struct {
	Status  bool   `json:"status"`
	Message string `json:"message"`
	Data    *T     `json:"data"`
}

type eidProfileResp struct {
	Email   string `json:"email"`
	Profile struct {
		FullName         string  `json:"fullname"`
		PhoneNumber      string  `json:"phonenumber"`
		CountryPhoneCode string  `json:"countryphonecode"`
		Address          string  `json:"address"`
		Tier             flexInt `json:"tier"`
	} `json:"profile"`
}

func (h *EIDHandler) getToken(ctx context.Context, code string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"client_id":     h.clientID,
		"client_secret": h.clientSecret,
		"code":          code,
		"redirect_uri":  h.callbackURL,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		h.apiBase+"/api/v1.1/oauth/get-token", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	var out eidEnvelope[struct {
		Token string `json:"token"`
	}]
	if err := h.do(req, &out); err != nil {
		return "", err
	}
	if out.Data.Token == "" {
		return "", fmt.Errorf("e.id get-token: empty token")
	}
	return out.Data.Token, nil
}

// getProfile — the default scope leaves the email out, so always ask for
// email:profile.
func (h *EIDHandler) getProfile(ctx context.Context, token string) (*eidProfileResp, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		h.apiBase+"/api/v1.1/oauth/get-profile?scope=email:profile", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	var out eidEnvelope[eidProfileResp]
	if err := h.do(req, &out); err != nil {
		return nil, err
	}
	return out.Data, nil
}

// do sends the request and decodes the envelope; a non-2xx status,
// status=false or null data is an error carrying e.id's message.
func (h *EIDHandler) do(req *http.Request, out interface {
	ok() (bool, string)
}) error {
	resp, err := h.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, out); err != nil {
		return fmt.Errorf("e.id %s: HTTP %d, body is not JSON", req.URL.Path, resp.StatusCode)
	}
	if ok, msg := out.ok(); !ok || resp.StatusCode/100 != 2 {
		return fmt.Errorf("e.id %s: HTTP %d %s", req.URL.Path, resp.StatusCode, msg)
	}
	return nil
}

func (e *eidEnvelope[T]) ok() (bool, string) { return e.Status && e.Data != nil, e.Message }

// flexInt — e.id documents tier as an integer but its examples use a string;
// accept both so a small change on their side does not break login.
type flexInt int

func (f *flexInt) UnmarshalJSON(b []byte) error {
	n, err := strconv.Atoi(strings.Trim(string(b), `"`))
	if err != nil {
		n = 0
	}
	*f = flexInt(n)
	return nil
}

// normalizeEIDProfile — e.id data fills the registrar (EPP) contact, so it
// follows the profile-edit rules: ASCII, bounded length. Anything else is
// dropped and the user fills it in later.
func normalizeEIDProfile(p *eidProfileResp) EIDProfile {
	out := EIDProfile{
		Email: strings.ToLower(strings.TrimSpace(p.Email)),
		Tier:  int(p.Profile.Tier),
	}
	if !strings.Contains(out.Email, "@") {
		out.Email = ""
	}
	if n := strings.TrimSpace(p.Profile.FullName); len(n) <= 128 && IsASCIIPrintable(n) {
		out.FullName = n
	}
	if a := strings.TrimSpace(p.Profile.Address); len(a) <= 255 && IsASCIIPrintable(a) {
		out.Address = a
	}
	if ph := eidPhone(p.Profile.CountryPhoneCode, p.Profile.PhoneNumber); ph != "" && len(ph) <= 32 && ValidPhone(ph) {
		out.Phone = ph
	}
	return out
}

// eidPhone joins country code + number into "+62812…". e.id may send the
// number with a leading 0, already prefixed with the code, or with "+".
func eidPhone(cc, num string) string {
	num = strings.TrimSpace(num)
	cc = strings.TrimLeft(strings.TrimSpace(cc), "+")
	if num == "" {
		return ""
	}
	if strings.HasPrefix(num, "+") || cc == "" {
		return num
	}
	num = strings.TrimLeft(num, "0")
	if strings.HasPrefix(num, cc) && len(num) > len(cc)+6 {
		return "+" + num
	}
	return "+" + cc + num
}

// ProvidersHandler — GET /api/v1/auth/providers. The login and register
// pages use it to show only the SSO buttons that are configured.
func ProvidersHandler(g *GoogleHandler, e *EIDHandler) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return httpx.OK(c, fiber.Map{
			"google": g != nil && g.Enabled(),
			"eid":    e != nil && e.Enabled(),
		})
	}
}

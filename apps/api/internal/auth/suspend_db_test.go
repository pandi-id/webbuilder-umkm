package auth

// Integration tests for the session gate. Need TEST_DATABASE_URL.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const testPassword = "rahasia-kuat-123"

// authApp wires the real handler, repo and issuer — the gate lives in the
// token funnel, so only an end-to-end request proves every door is covered.
func authApp(t *testing.T) (*fiber.App, *Repo) {
	t.Helper()
	repo := invRepo(t)
	h := NewHandler(repo, NewTokenIssuer("suspend-test-secret", time.Minute, time.Hour), HandlerOptions{})
	app := fiber.New()
	app.Post("/login", h.Login)
	app.Post("/refresh", h.Refresh)
	return app, repo
}

func mkLoginUser(t *testing.T, ctx context.Context, role string) (uuid.UUID, string) {
	t.Helper()
	hash, err := HashPassword(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	email := uniqEmail("gate")
	return makeUser(t, ctx, email, role, hash, nil), email
}

func suspend(t *testing.T, ctx context.Context, id uuid.UUID) {
	t.Helper()
	if _, err := invPool.Exec(ctx, `UPDATE users SET suspended_at = now() WHERE id = $1`, id); err != nil {
		t.Fatalf("suspend: %v", err)
	}
}

type envelope struct {
	Data struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	} `json:"data"`
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func post(t *testing.T, app *fiber.App, path string, body any) (int, envelope) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	defer resp.Body.Close()
	var env envelope
	_ = json.NewDecoder(resp.Body).Decode(&env)
	return resp.StatusCode, env
}

func activeRefreshTokens(t *testing.T, ctx context.Context, id uuid.UUID) int {
	t.Helper()
	var n int
	if err := invPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, id,
	).Scan(&n); err != nil {
		t.Fatalf("count tokens: %v", err)
	}
	return n
}

func TestLogin_SuspendedAccountIsRefused(t *testing.T) {
	app, _ := authApp(t)
	ctx := context.Background()
	id, email := mkLoginUser(t, ctx, RoleClient)
	suspend(t, ctx, id)

	status, env := post(t, app, "/login", map[string]string{"email": email, "password": testPassword})
	if status != fiber.StatusForbidden || env.Error.Code != "account_suspended" {
		t.Fatalf("status=%d code=%q, want 403 account_suspended", status, env.Error.Code)
	}
	if env.Data.AccessToken != "" {
		t.Error("a suspended account received an access token")
	}
	if n := activeRefreshTokens(t, ctx, id); n != 0 {
		t.Errorf("%d refresh tokens stored for a refused login", n)
	}
}

// Wrong password must look like any wrong password — never reveal that the
// account exists and is suspended to someone who does not hold it.
func TestLogin_WrongPasswordDoesNotRevealSuspension(t *testing.T) {
	app, _ := authApp(t)
	ctx := context.Background()
	id, email := mkLoginUser(t, ctx, RoleClient)
	suspend(t, ctx, id)

	status, env := post(t, app, "/login", map[string]string{"email": email, "password": "salah-total"})
	if status == fiber.StatusForbidden || env.Error.Code == "account_suspended" {
		t.Fatalf("status=%d code=%q — suspension leaked to a wrong password", status, env.Error.Code)
	}
}

func TestLogin_ActiveAccountStillWorks(t *testing.T) {
	app, _ := authApp(t)
	ctx := context.Background()
	_, email := mkLoginUser(t, ctx, RoleClient)

	status, env := post(t, app, "/login", map[string]string{"email": email, "password": testPassword})
	if status != fiber.StatusOK || env.Data.AccessToken == "" {
		t.Fatalf("status=%d, want 200 with tokens", status)
	}
}

// The gap this closes: Refresh minted access tokens without any gate, so a
// locked account kept a working session for the whole refresh TTL.
func TestRefresh_SuspendedAfterLoginIsRefused(t *testing.T) {
	app, _ := authApp(t)
	ctx := context.Background()
	id, email := mkLoginUser(t, ctx, RoleClient)

	_, env := post(t, app, "/login", map[string]string{"email": email, "password": testPassword})
	if env.Data.RefreshToken == "" {
		t.Fatal("login returned no refresh token")
	}
	suspend(t, ctx, id)

	status, out := post(t, app, "/refresh", map[string]string{"refresh_token": env.Data.RefreshToken})
	if status != fiber.StatusForbidden || out.Error.Code != "account_suspended" {
		t.Fatalf("status=%d code=%q, want 403 account_suspended", status, out.Error.Code)
	}
	if out.Data.AccessToken != "" {
		t.Error("refresh handed a suspended account a new access token")
	}
	// The token rotated in during the refused call must not survive.
	if n := activeRefreshTokens(t, ctx, id); n != 0 {
		t.Errorf("%d usable refresh tokens left after a refused refresh", n)
	}
}

// Same gap, older victim: a reseller suspended via reseller_status could
// refresh forever because only the password login checked the status.
func TestRefresh_SuspendedResellerIsRefused(t *testing.T) {
	app, _ := authApp(t)
	ctx := context.Background()
	id, email := mkLoginUser(t, ctx, RoleReseller)
	if _, err := invPool.Exec(ctx,
		`UPDATE users SET reseller_status = 'active' WHERE id = $1`, id); err != nil {
		t.Fatalf("activate: %v", err)
	}
	_, env := post(t, app, "/login", map[string]string{"email": email, "password": testPassword})
	if env.Data.RefreshToken == "" {
		t.Fatal("active reseller could not log in")
	}
	if _, err := invPool.Exec(ctx,
		`UPDATE users SET reseller_status = 'suspended' WHERE id = $1`, id); err != nil {
		t.Fatalf("suspend reseller: %v", err)
	}

	status, out := post(t, app, "/refresh", map[string]string{"refresh_token": env.Data.RefreshToken})
	if status != fiber.StatusForbidden || out.Error.Code != "role_locked" {
		t.Fatalf("status=%d code=%q, want 403 role_locked", status, out.Error.Code)
	}
}

func TestAllowLoginForRole(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name string
		u    *User
		code string // "" = allowed
	}{
		{"active client", &User{Role: RoleClient}, ""},
		{"suspended client", &User{Role: RoleClient, SuspendedAt: &now}, "account_suspended"},
		// Suspension wins over every role-specific state, including active reseller.
		{"suspended active reseller", &User{Role: RoleReseller, ResellerStatus: ResellerStatusActive, SuspendedAt: &now}, "account_suspended"},
		{"pending reseller", &User{Role: RoleReseller, ResellerStatus: ResellerStatusPending}, "role_locked"},
		{"active reseller", &User{Role: RoleReseller, ResellerStatus: ResellerStatusActive}, ""},
		{"nil user", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := AllowLoginForRole(tc.u)
			if tc.code == "" {
				if err != nil {
					t.Fatalf("err = %v, want allowed", err)
				}
				return
			}
			locked, ok := err.(*LoginLockedError)
			if !ok {
				t.Fatalf("err = %T %v, want *LoginLockedError", err, err)
			}
			if locked.Code != tc.code {
				t.Errorf("code = %q, want %q", locked.Code, tc.code)
			}
		})
	}
}

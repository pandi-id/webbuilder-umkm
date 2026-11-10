package auth

// Integration tests for e.id sign-in account matching. Need TEST_DATABASE_URL.

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// eidLogin runs the whole callback against a fake e.id returning `profile`
// and returns the web redirect.
func eidLogin(t *testing.T, profile map[string]any) *url.URL {
	t.Helper()
	repo := invRepo(t)
	srv := fakeEID(t, 200, "", profile)
	h := NewHandler(repo, NewTokenIssuer("eid-test-secret", time.Minute, time.Hour), HandlerOptions{})
	eid := NewEIDHandler(repo, h, "cid", "sec", srv.URL, eidTestCallback, "https://web.test")
	resp := eidGet(t, eidApp(eid), "/callback?code=ok", "abc./dashboard")
	if resp.StatusCode != fiber.StatusFound {
		t.Fatalf("callback status = %d, want 302", resp.StatusCode)
	}
	loc, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatalf("bad Location: %v", err)
	}
	return loc
}

func loggedIn(t *testing.T, loc *url.URL) {
	t.Helper()
	frag, _ := url.ParseQuery(loc.Fragment)
	if loc.Path != "/auth/callback" || frag.Get("access_token") == "" || frag.Get("refresh_token") == "" {
		t.Fatalf("expected a login redirect, got %s", loc)
	}
}

func loginError(t *testing.T, loc *url.URL, want string) {
	t.Helper()
	if loc.Path != "/login" || loc.Query().Get("error") != want {
		t.Fatalf("redirect = %s, want /login?error=%s", loc, want)
	}
}

type eidUser struct {
	ID       uuid.UUID
	Name     string
	Phone    string
	Address  string
	Verified bool
	HasPass  bool
}

func userByEmail(t *testing.T, ctx context.Context, email string) (eidUser, int) {
	t.Helper()
	var u eidUser
	var n int
	if err := invPool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE email = $1`, email).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n == 0 {
		return u, 0
	}
	if err := invPool.QueryRow(ctx, `
		SELECT id, name, phone_number, address, email_verified_at IS NOT NULL, COALESCE(password_hash, '') <> ''
		  FROM users WHERE email = $1`, email,
	).Scan(&u.ID, &u.Name, &u.Phone, &u.Address, &u.Verified, &u.HasPass); err != nil {
		t.Fatalf("user: %v", err)
	}
	return u, n
}

func identities(t *testing.T, ctx context.Context, userID uuid.UUID) int {
	t.Helper()
	var n int
	if err := invPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_identities WHERE user_id = $1 AND provider = 'eid'`, userID,
	).Scan(&n); err != nil {
		t.Fatalf("identities: %v", err)
	}
	return n
}

func TestEIDLogin_NewVerifiedUserIsCreatedWithProfile(t *testing.T) {
	ctx := context.Background()
	invRepo(t)
	email := uniqEmail("eid-new")

	loggedIn(t, eidLogin(t, eidProfileData(email, 2)))
	u, n := userByEmail(t, ctx, email)
	if n != 1 {
		t.Fatalf("users with email = %d, want 1", n)
	}
	if !u.Verified || u.HasPass {
		t.Errorf("verified=%v hasPassword=%v, want verified, no password", u.Verified, u.HasPass)
	}
	if u.Name != "Siti Rahma" || u.Phone != "+6281234567890" || u.Address != "Jl. Melati No. 12" {
		t.Errorf("profile not filled from e.id: %+v", u)
	}
	if identities(t, ctx, u.ID) != 1 {
		t.Error("no e.id identity stored")
	}

	// Coming back signs into the same account.
	loggedIn(t, eidLogin(t, eidProfileData(email, 2)))
	if _, n := userByEmail(t, ctx, email); n != 1 {
		t.Errorf("second login created another user")
	}
}

// Tier 0 may still sign up (product decision), but the email stays unverified.
func TestEIDLogin_Tier0CreatesUnverifiedAccount(t *testing.T) {
	ctx := context.Background()
	invRepo(t)
	email := uniqEmail("eid-t0")
	loggedIn(t, eidLogin(t, eidProfileData(email, 0)))
	if u, _ := userByEmail(t, ctx, email); u.Verified {
		t.Error("tier 0 marked the email as verified")
	}
}

// Linking keeps everything the user typed; e.id only fills the gaps.
func TestEIDLogin_LinksVerifiedEmailToExistingAccount(t *testing.T) {
	ctx := context.Background()
	invRepo(t)
	email := uniqEmail("eid-link")
	id := makeUser(t, ctx, email, RoleClient, "hash", nil)
	if _, err := invPool.Exec(ctx, `UPDATE users SET phone_number = '+620000000001' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}

	loggedIn(t, eidLogin(t, eidProfileData(email, 1)))
	u, n := userByEmail(t, ctx, email)
	if n != 1 || u.ID != id {
		t.Fatalf("expected the existing account %s, got %s (count %d)", id, u.ID, n)
	}
	if u.Name != "Nama Lama" || u.Phone != "+620000000001" {
		t.Errorf("existing data overwritten: %+v", u)
	}
	if u.Address != "Jl. Melati No. 12" {
		t.Errorf("empty address not filled: %q", u.Address)
	}
	if identities(t, ctx, id) != 1 {
		t.Error("identity not linked")
	}
}

// An unverified e.id email must not open someone else's account.
func TestEIDLogin_UnverifiedEmailDoesNotLinkExistingAccount(t *testing.T) {
	ctx := context.Background()
	invRepo(t)
	email := uniqEmail("eid-victim")
	id := makeUser(t, ctx, email, RoleClient, "hash", nil)

	loginError(t, eidLogin(t, eidProfileData(email, 0)), "eid_email_unverified")
	if identities(t, ctx, id) != 0 {
		t.Error("unverified e.id identity was linked to the existing account")
	}
}

// Squatting: a tier-0 e.id account creates the user first, the real owner
// later recovers it with a password reset. The squatter must lose access.
func TestEIDLogin_UnverifiedIdentityLosesAccessOnceAccountHasPassword(t *testing.T) {
	ctx := context.Background()
	invRepo(t)
	email := uniqEmail("eid-squat")
	loggedIn(t, eidLogin(t, eidProfileData(email, 0)))

	u, _ := userByEmail(t, ctx, email)
	if _, err := invPool.Exec(ctx, `UPDATE users SET password_hash = 'reset-by-owner' WHERE id = $1`, u.ID); err != nil {
		t.Fatal(err)
	}
	loginError(t, eidLogin(t, eidProfileData(email, 0)), "eid_email_unverified")

	// Once e.id verifies the email, the identity is trusted again.
	loggedIn(t, eidLogin(t, eidProfileData(email, 1)))
}

func TestEIDLogin_NonASCIIAddressIsSkipped(t *testing.T) {
	ctx := context.Background()
	invRepo(t)
	email := uniqEmail("eid-ascii")
	p := eidProfileData(email, 2)
	p["profile"].(map[string]any)["address"] = "Jl. Café — Blok Ä"
	loggedIn(t, eidLogin(t, p))
	if u, _ := userByEmail(t, ctx, email); u.Address != "" {
		t.Errorf("non-ASCII address stored: %q (EPP rejects it)", u.Address)
	}
}

func TestEIDLogin_SuspendedAccountIsRefused(t *testing.T) {
	ctx := context.Background()
	invRepo(t)
	email := uniqEmail("eid-susp")
	id := makeUser(t, ctx, email, RoleClient, "hash", nil)
	suspend(t, ctx, id)
	loginError(t, eidLogin(t, eidProfileData(email, 2)), "account_suspended")
}

func TestEIDLogin_NoEmail(t *testing.T) {
	invRepo(t)
	loginError(t, eidLogin(t, eidProfileData("", 2)), "eid_no_email")
}

// An e.id-only account already logs in: a manager must not be able to send it
// a set-password invite, and accepting an invite must not demand a password.
func TestHasLogin_CountsEIDIdentity(t *testing.T) {
	ctx := context.Background()
	repo := invRepo(t)
	email := uniqEmail("eid-haslogin")
	loggedIn(t, eidLogin(t, eidProfileData(email, 2)))
	u, _ := userByEmail(t, ctx, email)

	ok, err := repo.HasLogin(ctx, u.ID)
	if err != nil || !ok {
		t.Fatalf("HasLogin = %v, %v; want true for an e.id-only account", ok, err)
	}

	reseller := makeReseller(t, ctx)
	raw, _, err := repo.CreateInvitation(ctx, email, RoleAgent, reseller, &u.ID, time.Hour)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, nil, ""); err != nil {
		t.Fatalf("accept without password: %v (e.id-only account treated as having no login)", err)
	}
	if u2, _ := userByEmail(t, ctx, email); u2.HasPass {
		t.Error("accepting the invite set a password on an e.id account")
	}

	placeholder := makeUser(t, ctx, uniqEmail("placeholder"), RoleClient, "", nil)
	if ok, _ := repo.HasLogin(ctx, placeholder); ok {
		t.Error("placeholder account without any login reported as having one")
	}
}

// Ported from the website repo: a tier-0 sign-up becomes verified once e.id
// reports tier 1, and NIK is never filled from e.id.
func TestUpsertEIDUser_TierUpgradeAndNIK(t *testing.T) {
	ctx := context.Background()
	repo := invRepo(t)
	email := uniqEmail("eid-up")
	u, err := repo.UpsertEIDUser(ctx, EIDProfile{Email: email, FullName: "Budi", Phone: "+6281234567890", Address: "Jl. A", Tier: 0})
	if err != nil {
		t.Fatal(err)
	}
	if u.EmailVerifiedAt != nil || u.PasswordHash != "" || u.Nik != "" {
		t.Fatalf("tier 0 sign-up: %+v", u)
	}
	u2, err := repo.UpsertEIDUser(ctx, EIDProfile{Email: email, Tier: 1})
	if err != nil {
		t.Fatal(err)
	}
	if u2.ID != u.ID || u2.EmailVerifiedAt == nil || u2.Name != "Budi" {
		t.Fatalf("relogin at tier 1: %+v", u2)
	}
	var tier int
	if err := invPool.QueryRow(ctx,
		`SELECT tier FROM user_identities WHERE provider = 'eid' AND subject = $1`, email,
	).Scan(&tier); err != nil || tier != 1 {
		t.Fatalf("identity tier = %d, %v; want 1", tier, err)
	}
}

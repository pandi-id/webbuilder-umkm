package auth

// Integration tests for the invitation accept paths. Need TEST_DATABASE_URL;
// skipped otherwise.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/webbuilder/api/internal/db"
)

var invPool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		os.Exit(m.Run())
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		panic("connect test db: " + err.Error())
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool, url); err != nil {
		panic("migrate test db: " + err.Error())
	}
	invPool = pool
	os.Exit(m.Run())
}

func invRepo(t *testing.T) *Repo {
	t.Helper()
	if invPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	return NewRepo(invPool)
}

func uniqEmail(prefix string) string {
	return prefix + "-" + uuid.NewString()[:8] + "@test.local"
}

// makeUser inserts a user directly so tests can set any role/password shape.
func makeUser(t *testing.T, ctx context.Context, email, role, passwordHash string, parent *uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := invPool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, name, role, parent_reseller_id, email_verified_at)
		 VALUES ($1, $2, 'Nama Lama', $3, $4, now()) RETURNING id`,
		email, passwordHash, role, parent,
	).Scan(&id); err != nil {
		t.Fatalf("makeUser: %v", err)
	}
	return id
}

func makeReseller(t *testing.T, ctx context.Context) uuid.UUID {
	t.Helper()
	id := makeUser(t, ctx, uniqEmail("reseller"), RoleReseller, "hash", nil)
	if _, err := invPool.Exec(ctx,
		`UPDATE users SET reseller_display_name = 'Toko Reseller', reseller_status = 'active' WHERE id = $1`, id,
	); err != nil {
		t.Fatalf("makeReseller: %v", err)
	}
	return id
}

func userRow(t *testing.T, ctx context.Context, id uuid.UUID) (role, pwHash, name string, parent *uuid.UUID) {
	t.Helper()
	if err := invPool.QueryRow(ctx,
		`SELECT role, password_hash, name, parent_reseller_id FROM users WHERE id = $1`, id,
	).Scan(&role, &pwHash, &name, &parent); err != nil {
		t.Fatalf("userRow: %v", err)
	}
	return
}

func strptr(s string) *string { return &s }

// Promoting an existing client must keep their password and account intact —
// they own sites and domains from before and must still be able to log in.
func TestAcceptInvitation_PromotesExistingUserWithoutTouchingPassword(t *testing.T) {
	repo := invRepo(t)
	ctx := context.Background()
	reseller := makeReseller(t, ctx)
	email := uniqEmail("klien")
	userID := makeUser(t, ctx, email, RoleClient, "hash-lama", nil)

	raw, _, err := repo.CreateInvitation(ctx, email, RoleAgent, reseller, &userID, time.Hour)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}

	// No password in the accept request — they already have one.
	gotID, role, err := repo.AcceptInvitationTx(ctx, raw, nil, "")
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if gotID != userID {
		t.Errorf("user id = %s, want the existing %s (a new row was created)", gotID, userID)
	}
	if role != RoleAgent {
		t.Errorf("invited role = %q, want agent", role)
	}

	gotRole, pw, name, parent := userRow(t, ctx, userID)
	if gotRole != RoleAgent {
		t.Errorf("role = %q, want agent", gotRole)
	}
	if pw != "hash-lama" {
		t.Errorf("password_hash = %q — an existing password must never be overwritten", pw)
	}
	if name != "Nama Lama" {
		t.Errorf("name = %q, want the existing name kept", name)
	}
	if parent == nil || *parent != reseller {
		t.Errorf("parent_reseller_id = %v, want %s", parent, reseller)
	}
}

// A client placeholder has no way to log in, so the invite must set one.
func TestAcceptInvitation_PlaceholderStillNeedsPassword(t *testing.T) {
	repo := invRepo(t)
	ctx := context.Background()
	reseller := makeReseller(t, ctx)
	email := uniqEmail("placeholder")
	userID := makeUser(t, ctx, email, RoleClient, "", nil) // no password, no oauth

	raw, _, err := repo.CreateInvitation(ctx, email, RoleAgent, reseller, &userID, time.Hour)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, nil, "Budi"); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("err = %v, want ErrPasswordRequired", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, strptr("hash-baru"), "Budi"); err != nil {
		t.Fatalf("accept with password: %v", err)
	}
	gotRole, pw, _, parent := userRow(t, ctx, userID)
	if gotRole != RoleAgent || pw != "hash-baru" {
		t.Errorf("role = %q, password = %q, want agent/hash-baru", gotRole, pw)
	}
	if parent == nil || *parent != reseller {
		t.Errorf("parent_reseller_id = %v, want %s", parent, reseller)
	}
}

// A Google-only account can log in without a password_hash, so promoting it
// must not demand one.
func TestAcceptInvitation_OAuthUserNeedsNoPassword(t *testing.T) {
	repo := invRepo(t)
	ctx := context.Background()
	reseller := makeReseller(t, ctx)
	email := uniqEmail("google")
	userID := makeUser(t, ctx, email, RoleClient, "", nil)
	if _, err := invPool.Exec(ctx,
		`UPDATE users SET oauth_google_sub = $2 WHERE id = $1`, userID, "google-"+uuid.NewString()); err != nil {
		t.Fatalf("set oauth: %v", err)
	}

	raw, _, err := repo.CreateInvitation(ctx, email, RoleAgent, reseller, &userID, time.Hour)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, nil, ""); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if role, pw, _, _ := userRow(t, ctx, userID); role != RoleAgent || pw != "" {
		t.Errorf("role = %q, password = %q, want agent with no password set", role, pw)
	}
}

// The brand-new-agent path is unchanged: password and name both required.
func TestAcceptInvitation_NewAgentRequiresPasswordAndName(t *testing.T) {
	repo := invRepo(t)
	ctx := context.Background()
	reseller := makeReseller(t, ctx)
	email := uniqEmail("baru")

	raw, _, err := repo.CreateInvitation(ctx, email, RoleAgent, reseller, nil, time.Hour)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, nil, "Budi"); !errors.Is(err, ErrPasswordRequired) {
		t.Errorf("no password: err = %v, want ErrPasswordRequired", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, strptr("h"), "  "); !errors.Is(err, ErrNameRequired) {
		t.Errorf("no name: err = %v, want ErrNameRequired", err)
	}
	id, _, err := repo.AcceptInvitationTx(ctx, raw, strptr("h"), "Budi")
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if role, _, name, parent := userRow(t, ctx, id); role != RoleAgent || name != "Budi" || parent == nil {
		t.Errorf("role = %q, name = %q, parent = %v", role, name, parent)
	}
}

// Promoting a client invite must not touch the role — only agent invites do.
func TestAcceptInvitation_ClientInviteKeepsRole(t *testing.T) {
	repo := invRepo(t)
	ctx := context.Background()
	reseller := makeReseller(t, ctx)
	email := uniqEmail("klienbaru")
	userID := makeUser(t, ctx, email, RoleClient, "", nil)

	raw, _, err := repo.CreateInvitation(ctx, email, RoleClient, reseller, &userID, time.Hour)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, strptr("hash"), "Budi"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	role, _, _, parent := userRow(t, ctx, userID)
	if role != RoleClient {
		t.Errorf("role = %q, want client unchanged", role)
	}
	if parent != nil {
		t.Errorf("parent_reseller_id = %v, want nil for a client invite", parent)
	}
}

func TestAcceptInvitation_TokenIsSingleUse(t *testing.T) {
	repo := invRepo(t)
	ctx := context.Background()
	reseller := makeReseller(t, ctx)
	email := uniqEmail("sekali")
	userID := makeUser(t, ctx, email, RoleClient, "hash-lama", nil)

	raw, _, err := repo.CreateInvitation(ctx, email, RoleAgent, reseller, &userID, time.Hour)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, nil, ""); err != nil {
		t.Fatalf("first accept: %v", err)
	}
	if _, _, err := repo.AcceptInvitationTx(ctx, raw, nil, ""); err == nil {
		t.Error("second accept succeeded; the token must be single-use")
	}
}

// The literal complaint behind the /invite page bug: a freshly sent invitation
// must resolve immediately. This guards the backend half of that contract —
// expiry window, hashing and the accepted/expired filters.
func TestFindInvitationByToken_FreshInviteIsValid(t *testing.T) {
	repo := invRepo(t)
	ctx := context.Background()
	reseller := makeReseller(t, ctx)
	email := uniqEmail("segar")

	raw, created, err := repo.CreateInvitation(ctx, email, RoleAgent, reseller, nil, 0)
	if err != nil {
		t.Fatalf("create invitation: %v", err)
	}
	// Default TTL must be in the future, not the past.
	if !created.ExpiresAt.After(time.Now()) {
		t.Fatalf("expires_at = %v is not in the future", created.ExpiresAt)
	}

	found, err := repo.FindInvitationByToken(ctx, raw)
	if err != nil {
		t.Fatalf("fresh invitation did not resolve: %v", err)
	}
	if found.ID != created.ID || found.Email != email {
		t.Errorf("found %s/%s, want %s/%s", found.ID, found.Email, created.ID, email)
	}

	// A token that is not ours must stay a miss, not a lucky match.
	if _, err := repo.FindInvitationByToken(ctx, "token-yang-salah"); !errors.Is(err, ErrNotFound) {
		t.Errorf("bogus token err = %v, want ErrNotFound", err)
	}
	// And the empty string must never resolve — that is what the broken page
	// effectively sent ("undefined" in the URL).
	if _, err := repo.FindInvitationByToken(ctx, ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("empty token err = %v, want ErrNotFound", err)
	}
}

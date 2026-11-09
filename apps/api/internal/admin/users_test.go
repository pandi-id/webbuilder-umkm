package admin

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/db"
)

// Granting admin is the most dangerous action in the panel, so every refusal
// path is pinned here — without a database.
func TestRoleChangeBlocker(t *testing.T) {
	client := &UserBrief{Email: "budi@toko.id", Role: auth.RoleClient}
	cases := []struct {
		name    string
		target  *UserBrief
		role    string
		confirm string
		blocked bool
	}{
		{"promote with matching email", client, auth.RoleAdmin, "budi@toko.id", false},
		{"promote ignores case and spaces", client, auth.RoleAdmin, "  BUDI@toko.ID ", false},
		{"promote without confirmation", client, auth.RoleAdmin, "", true},
		{"promote with someone else's email", client, auth.RoleAdmin, "andi@toko.id", true},
		{"promote a reseller", &UserBrief{Email: "r@x.id", Role: auth.RoleReseller}, auth.RoleAdmin, "r@x.id", true},
		{"promote an agent", &UserBrief{Email: "a@x.id", Role: auth.RoleAgent}, auth.RoleAdmin, "a@x.id", true},
		{"promote a suspended client", &UserBrief{Email: "s@x.id", Role: auth.RoleClient, Suspended: true}, auth.RoleAdmin, "s@x.id", true},
		{"promote an admin again", &UserBrief{Email: "ad@x.id", Role: auth.RoleAdmin}, auth.RoleAdmin, "ad@x.id", true},
		{"demote an admin", &UserBrief{Email: "ad@x.id", Role: auth.RoleAdmin}, auth.RoleClient, "", false},
		{"demote a non-admin", client, auth.RoleClient, "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := roleChangeBlocker(tc.target, tc.role, tc.confirm)
			if (got != "") != tc.blocked {
				t.Errorf("blocker = %q (blocked=%v), want blocked=%v", got, got != "", tc.blocked)
			}
		})
	}
}

// ---- DB ----

var testPool *pgxpool.Pool

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
	testPool = pool
	os.Exit(m.Run())
}

func needsDB(t *testing.T) *Repo {
	t.Helper()
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	return NewRepo(testPool)
}

func mkUser(t *testing.T, ctx context.Context, role string) (uuid.UUID, string) {
	t.Helper()
	email := "adm-" + uuid.NewString()[:8] + "@test.local"
	var id uuid.UUID
	if err := testPool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'h', 'Uji', $2) RETURNING id`,
		email, role).Scan(&id); err != nil {
		t.Fatalf("mkUser: %v", err)
	}
	return id, email
}

func mkRefreshToken(t *testing.T, ctx context.Context, user uuid.UUID) {
	t.Helper()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')`,
		user, uuid.NewString()); err != nil {
		t.Fatalf("mkRefreshToken: %v", err)
	}
}

func liveTokens(t *testing.T, ctx context.Context, user uuid.UUID) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, user,
	).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// Suspending must leave no refresh token that could renew the session.
func TestSuspendUser_RevokesEverySession(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	admin, _ := mkUser(t, ctx, auth.RoleAdmin)
	target, _ := mkUser(t, ctx, auth.RoleClient)
	bystander, _ := mkUser(t, ctx, auth.RoleClient)
	for i := 0; i < 3; i++ { // e.g. phone, laptop, tablet
		mkRefreshToken(t, ctx, target)
	}
	mkRefreshToken(t, ctx, bystander)

	if err := repo.SuspendUser(ctx, target, admin, "spam pendaftaran"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if n := liveTokens(t, ctx, target); n != 0 {
		t.Errorf("%d refresh tokens still live after suspend", n)
	}
	if n := liveTokens(t, ctx, bystander); n != 1 {
		t.Errorf("bystander lost tokens (%d live) — revoke must be scoped to the target", n)
	}

	b, err := repo.GetUserBrief(ctx, target)
	if err != nil || !b.Suspended {
		t.Fatalf("brief = %+v err = %v, want suspended", b, err)
	}
}

// A repeat suspend updates the reason but keeps the original timestamp, so
// "suspended since" stays truthful.
func TestSuspendUser_RepeatKeepsFirstTimestamp(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	admin, _ := mkUser(t, ctx, auth.RoleAdmin)
	target, _ := mkUser(t, ctx, auth.RoleClient)

	if err := repo.SuspendUser(ctx, target, admin, "pertama"); err != nil {
		t.Fatalf("suspend 1: %v", err)
	}
	var first string
	_ = testPool.QueryRow(ctx, `SELECT suspended_at::text FROM users WHERE id = $1`, target).Scan(&first)
	if err := repo.SuspendUser(ctx, target, admin, "kedua"); err != nil {
		t.Fatalf("suspend 2: %v", err)
	}
	var second, reason string
	_ = testPool.QueryRow(ctx,
		`SELECT suspended_at::text, suspended_reason FROM users WHERE id = $1`, target).Scan(&second, &reason)
	if first != second {
		t.Errorf("suspended_at moved from %s to %s", first, second)
	}
	if reason != "kedua" {
		t.Errorf("reason = %q, want the latest", reason)
	}
}

func TestUnsuspendUser_ClearsAllFields(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	admin, _ := mkUser(t, ctx, auth.RoleAdmin)
	target, email := mkUser(t, ctx, auth.RoleClient)
	if err := repo.SuspendUser(ctx, target, admin, "spam"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if err := repo.UnsuspendUser(ctx, target); err != nil {
		t.Fatalf("unsuspend: %v", err)
	}
	b, _ := repo.GetUserBrief(ctx, target)
	if b.Suspended {
		t.Error("still suspended after unsuspend")
	}

	// And the list stops showing the badge.
	rows, _, err := repo.ListUsersPage(ctx, "%"+strings.ToLower(email)+"%", "", 10, 0)
	if err != nil || len(rows) != 1 {
		t.Fatalf("list: rows=%d err=%v", len(rows), err)
	}
	if rows[0].SuspendedAt != nil || rows[0].SuspendedReason != "" {
		t.Errorf("list row still carries suspension: %+v", rows[0])
	}
}

func TestListUsersPage_ShowsSuspension(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	admin, _ := mkUser(t, ctx, auth.RoleAdmin)
	target, email := mkUser(t, ctx, auth.RoleClient)
	if err := repo.SuspendUser(ctx, target, admin, "akun spam"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	rows, _, err := repo.ListUsersPage(ctx, "%"+strings.ToLower(email)+"%", "", 10, 0)
	if err != nil || len(rows) != 1 {
		t.Fatalf("list: rows=%d err=%v", len(rows), err)
	}
	if rows[0].SuspendedAt == nil || rows[0].SuspendedReason != "akun spam" {
		t.Errorf("row = %+v, want suspended with reason", rows[0])
	}
}

func TestSuspendUser_UnknownIsNotFound(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	admin, _ := mkUser(t, ctx, auth.RoleAdmin)
	if err := repo.SuspendUser(ctx, uuid.New(), admin, ""); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

// The detail page decides which buttons to show from this; an unpopulated
// field would make every suspended account look active there.
func TestGetUserDetail_CarriesSuspension(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	admin, _ := mkUser(t, ctx, auth.RoleAdmin)
	target, _ := mkUser(t, ctx, auth.RoleClient)
	if err := repo.SuspendUser(ctx, target, admin, "spam"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	d, err := repo.GetUserDetail(ctx, target)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if d.SuspendedAt == nil || d.SuspendedReason != "spam" {
		t.Errorf("detail suspended_at=%v reason=%q, want set", d.SuspendedAt, d.SuspendedReason)
	}
}

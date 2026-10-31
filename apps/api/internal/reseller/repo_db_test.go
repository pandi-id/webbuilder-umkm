package reseller

// Integration tests. Need TEST_DATABASE_URL; skipped otherwise.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/db"
)

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

// mkUser inserts a user. passwordHash "" = an invited placeholder that has not
// accepted yet.
func mkUser(t *testing.T, ctx context.Context, role, passwordHash string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	email := role + "-" + uuid.NewString()[:8] + "@test.local"
	if err := testPool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, 'Uji', $3) RETURNING id`,
		email, passwordHash, role,
	).Scan(&id); err != nil {
		t.Fatalf("mkUser: %v", err)
	}
	return id
}

func listed(t *testing.T, ctx context.Context, r *Repo, manager uuid.UUID) []ClientRow {
	t.Helper()
	rows, err := r.ListClientsByManager(ctx, manager)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	return rows
}

// Unlinking drops the client from the manager's list but must leave the user
// account alone — clients own their own sites and domains.
func TestRevokeAssignment_RemovesFromListButKeepsUser(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	manager := mkUser(t, ctx, auth.RoleReseller, "hash")
	client := mkUser(t, ctx, auth.RoleClient, "hash-klien")

	if _, err := repo.CreateAssignment(ctx, manager, client, auth.RoleReseller); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if len(listed(t, ctx, repo, manager)) != 1 {
		t.Fatal("client not listed after assignment")
	}

	if err := repo.RevokeAssignment(ctx, manager, client); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if n := len(listed(t, ctx, repo, manager)); n != 0 {
		t.Errorf("listed %d clients after revoke, want 0", n)
	}

	// The account must still exist and keep its password.
	var pw string
	if err := testPool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, client).Scan(&pw); err != nil {
		t.Fatalf("client user was removed: %v", err)
	}
	if pw != "hash-klien" {
		t.Errorf("password_hash = %q, want untouched", pw)
	}
}

// Unlinking must be reversible: (manager_id, client_id) is UNIQUE, so a naive
// insert would make re-adding impossible forever.
func TestCreateAssignment_RevivesRevokedPairing(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	manager := mkUser(t, ctx, auth.RoleReseller, "hash")
	client := mkUser(t, ctx, auth.RoleClient, "hash")

	if _, err := repo.CreateAssignment(ctx, manager, client, auth.RoleReseller); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if err := repo.RevokeAssignment(ctx, manager, client); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	a, err := repo.CreateAssignment(ctx, manager, client, auth.RoleReseller)
	if err != nil {
		t.Fatalf("re-assign after revoke: %v", err)
	}
	if a.AccessStatus != AccessStatusSetup {
		t.Errorf("access_status = %q, want setup", a.AccessStatus)
	}
	if a.RevokedAt != nil {
		t.Errorf("revoked_at = %v, want cleared", a.RevokedAt)
	}
	if len(listed(t, ctx, repo, manager)) != 1 {
		t.Error("client not back in the list after re-assignment")
	}
}

// A live assignment is still a conflict — reviving must not silently reset an
// active relationship.
func TestCreateAssignment_ActiveStaysConflict(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	manager := mkUser(t, ctx, auth.RoleReseller, "hash")
	client := mkUser(t, ctx, auth.RoleClient, "hash")

	if _, err := repo.CreateAssignment(ctx, manager, client, auth.RoleReseller); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if _, err := repo.CreateAssignment(ctx, manager, client, auth.RoleReseller); !errors.Is(err, ErrAlreadyAssigned) {
		t.Errorf("err = %v, want ErrAlreadyAssigned", err)
	}
}

// One manager must not be able to unlink another manager's client.
func TestRevokeAssignment_ScopedToManager(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	mine := mkUser(t, ctx, auth.RoleReseller, "hash")
	theirs := mkUser(t, ctx, auth.RoleReseller, "hash")
	client := mkUser(t, ctx, auth.RoleClient, "hash")

	if _, err := repo.CreateAssignment(ctx, mine, client, auth.RoleReseller); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if err := repo.RevokeAssignment(ctx, theirs, client); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-manager revoke err = %v, want ErrNotFound", err)
	}
	if len(listed(t, ctx, repo, mine)) != 1 {
		t.Error("client disappeared from the rightful manager's list")
	}
	// Revoking twice is not an error the second time around — it is a no-op miss.
	if err := repo.RevokeAssignment(ctx, mine, client); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := repo.RevokeAssignment(ctx, mine, client); !errors.Is(err, ErrNotFound) {
		t.Errorf("double revoke err = %v, want ErrNotFound", err)
	}
}

// has_login drives whether the UI offers "kirim ulang undangan"; it must not
// be confused with email verification.
func TestListClientsByManager_HasLogin(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	manager := mkUser(t, ctx, auth.RoleReseller, "hash")
	placeholder := mkUser(t, ctx, auth.RoleClient, "")     // invited, never accepted
	realUser := mkUser(t, ctx, auth.RoleClient, "hash-ok") // signed up themselves

	for _, c := range []uuid.UUID{placeholder, realUser} {
		if _, err := repo.CreateAssignment(ctx, manager, c, auth.RoleReseller); err != nil {
			t.Fatalf("assign: %v", err)
		}
	}

	byID := map[uuid.UUID]ClientRow{}
	for _, r := range listed(t, ctx, repo, manager) {
		byID[r.Assignment.ClientID] = r
	}
	if byID[placeholder].HasLogin {
		t.Error("placeholder reported as having a login")
	}
	if !byID[realUser].HasLogin {
		t.Error("real user reported as having no login")
	}

	// A Google-only account can log in without a password hash.
	oauth := mkUser(t, ctx, auth.RoleClient, "")
	if _, err := testPool.Exec(ctx,
		`UPDATE users SET oauth_google_sub = $2 WHERE id = $1`, oauth, "g-"+uuid.NewString()); err != nil {
		t.Fatalf("set oauth: %v", err)
	}
	if _, err := repo.CreateAssignment(ctx, manager, oauth, auth.RoleReseller); err != nil {
		t.Fatalf("assign oauth: %v", err)
	}
	for _, r := range listed(t, ctx, repo, manager) {
		if r.Assignment.ClientID == oauth && !r.HasLogin {
			t.Error("Google-only account reported as having no login")
		}
	}
}

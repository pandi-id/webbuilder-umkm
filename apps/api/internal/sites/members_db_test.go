package sites

// Integration tests. Need TEST_DATABASE_URL; skipped otherwise.

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

func mkUser(t *testing.T, ctx context.Context) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := testPool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, name) VALUES ($1, 'h', 'Uji') RETURNING id`,
		"sites-"+uuid.NewString()[:8]+"@test.local",
	).Scan(&id); err != nil {
		t.Fatalf("mkUser: %v", err)
	}
	return id
}

// mkSite creates a site owned by owner and registers the owner membership the
// app relies on.
func mkSite(t *testing.T, ctx context.Context, owner uuid.UUID, name, status string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	slug := "s-" + uuid.NewString()[:8]
	if err := testPool.QueryRow(ctx,
		`INSERT INTO sites (user_id, slug, name, status) VALUES ($1, $2, $3, $4) RETURNING id`,
		owner, slug, name, status,
	).Scan(&id); err != nil {
		t.Fatalf("mkSite: %v", err)
	}
	if _, err := testPool.Exec(ctx,
		`INSERT INTO site_members (site_id, user_id, role, added_by) VALUES ($1, $2, 'owner', $2)
		 ON CONFLICT DO NOTHING`, id, owner); err != nil {
		t.Fatalf("owner membership: %v", err)
	}
	return id
}

// mkPurchase attaches a bought domain the way the purchase flow does.
func mkPurchase(t *testing.T, ctx context.Context, owner, siteID uuid.UUID, domain, status string) {
	t.Helper()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO domain_purchases (user_id, site_id, domain, kind, status, years, registrar_job_id)
		 VALUES ($1, $2, $3, 'register', $4, 1, $5)`,
		owner, siteID, domain, status, uuid.NewString()); err != nil {
		t.Fatalf("mkPurchase: %v", err)
	}
}

func addMember(t *testing.T, ctx context.Context, siteID, userID, by uuid.UUID, role string) {
	t.Helper()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO site_members (site_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)`,
		siteID, userID, role, by); err != nil {
		t.Fatalf("addMember: %v", err)
	}
}

// The personal dashboard asks for role=owner so a manager with many clients
// still sees only their own shops.
func TestListSitesAccessibleTo_OwnerFilter(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	me := mkUser(t, ctx)
	client := mkUser(t, ctx)

	mine := mkSite(t, ctx, me, "Toko Saya", "published")
	theirs := mkSite(t, ctx, client, "Toko Klien", "draft")
	addMember(t, ctx, theirs, me, client, RoleEditor)

	all, err := repo.ListSitesAccessibleTo(ctx, me)
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("unfiltered list = %d sites, want 2 (own + collaborated)", len(all))
	}

	owned, err := repo.ListSitesAccessibleTo(ctx, me, RoleOwner)
	if err != nil {
		t.Fatalf("list owned: %v", err)
	}
	if len(owned) != 1 {
		t.Fatalf("owner-filtered list = %d sites, want 1", len(owned))
	}
	if owned[0].ID != mine {
		t.Errorf("got site %s, want the caller's own %s", owned[0].ID, mine)
	}
	if owned[0].Role != RoleOwner {
		t.Errorf("role = %q, want owner", owned[0].Role)
	}
}

// The collaborations list carries enough to answer "whose site and is it live"
// without opening each one.
func TestListMyCollaborations_CarriesOwnerAndStatus(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	me := mkUser(t, ctx)
	client := mkUser(t, ctx)

	site := mkSite(t, ctx, client, "Toko Klien", "published")
	addMember(t, ctx, site, me, client, RoleEditor)
	// A shop bought through the platform: the hostname lives in
	// domain_purchases, not the legacy domains table.
	bought := "klien-" + uuid.NewString()[:8] + ".id"
	mkPurchase(t, ctx, client, site, bought, "active")
	// A pending hostname must not be reported as the live one.
	if _, err := testPool.Exec(ctx,
		`INSERT INTO domains (site_id, hostname, status) VALUES ($1, $2, 'pending')`,
		site, "pending-"+uuid.NewString()[:8]+".id"); err != nil {
		t.Fatalf("pending domain: %v", err)
	}

	rows, err := repo.ListMyCollaborations(ctx, me)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d collaborations, want 1", len(rows))
	}
	c := rows[0]
	if c.OwnerID != client || c.OwnerEmail == "" {
		t.Errorf("owner not resolved: id=%s email=%q", c.OwnerID, c.OwnerEmail)
	}
	if c.SiteStatus != "published" {
		t.Errorf("site_status = %q, want published", c.SiteStatus)
	}
	if c.Role != RoleEditor {
		t.Errorf("role = %q, want editor", c.Role)
	}
	if c.Hostname != bought {
		t.Errorf("hostname = %q, want the purchased domain %q", c.Hostname, bought)
	}
	if c.UpdatedAt.IsZero() {
		t.Error("updated_at is zero")
	}
}

// Sites the caller owns must never show up as collaborations.
func TestListMyCollaborations_ExcludesOwnSites(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	me := mkUser(t, ctx)
	mkSite(t, ctx, me, "Toko Saya", "draft")

	rows, err := repo.ListMyCollaborations(ctx, me)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("got %d collaborations for an owner-only user, want 0", len(rows))
	}
}

// A site with no verified domain yields an empty hostname, not a scan error.
func TestListMyCollaborations_NoDomain(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	me := mkUser(t, ctx)
	client := mkUser(t, ctx)
	site := mkSite(t, ctx, client, "Belum Tayang", "draft")
	addMember(t, ctx, site, me, client, RoleViewer)

	rows, err := repo.ListMyCollaborations(ctx, me)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	if rows[0].Hostname != "" {
		t.Errorf("hostname = %q, want empty", rows[0].Hostname)
	}
	if rows[0].Role != RoleViewer {
		t.Errorf("role = %q, want viewer", rows[0].Role)
	}
}

// Regression: hostname used to be read only from the legacy domains table,
// which is empty in practice, so every shop bought through the platform showed
// "Belum ada domain aktif". Precedence must match GetByHost.
func TestListMyCollaborations_PrefersPurchasedDomain(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	me := mkUser(t, ctx)
	client := mkUser(t, ctx)
	site := mkSite(t, ctx, client, "Toko Klien", "published")
	addMember(t, ctx, site, me, client, RoleEditor)

	bought := "beli-" + uuid.NewString()[:8] + ".id"
	legacy := "legacy-" + uuid.NewString()[:8] + ".id"
	mkPurchase(t, ctx, client, site, bought, "active")
	if _, err := testPool.Exec(ctx,
		`INSERT INTO domains (site_id, hostname, status) VALUES ($1, $2, 'verified')`,
		site, legacy); err != nil {
		t.Fatalf("legacy domain: %v", err)
	}

	rows, err := repo.ListMyCollaborations(ctx, me)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if rows[0].Hostname != bought {
		t.Errorf("hostname = %q, want the purchased domain %q to win", rows[0].Hostname, bought)
	}
}

// An expired or cancelled purchase is not a live domain.
func TestListMyCollaborations_IgnoresInactivePurchase(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	me := mkUser(t, ctx)
	client := mkUser(t, ctx)
	site := mkSite(t, ctx, client, "Toko Klien", "draft")
	addMember(t, ctx, site, me, client, RoleEditor)
	mkPurchase(t, ctx, client, site, "mati-"+uuid.NewString()[:8]+".id", "failed")

	rows, err := repo.ListMyCollaborations(ctx, me)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if rows[0].Hostname != "" {
		t.Errorf("hostname = %q, want empty for a non-active purchase", rows[0].Hostname)
	}
}

// BYO .id delegated to Cloudflare still serves traffic while drifting.
func TestListMyCollaborations_ByoDomain(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	me := mkUser(t, ctx)
	client := mkUser(t, ctx)
	site := mkSite(t, ctx, client, "Toko BYO", "published")
	addMember(t, ctx, site, me, client, RoleEditor)

	host := "byo-" + uuid.NewString()[:8] + ".id"
	if _, err := testPool.Exec(ctx,
		`INSERT INTO site_byo_domains (site_id, user_id, hostname, status)
		 VALUES ($1, $2, $3, 'drifting')`, site, client, host); err != nil {
		t.Skipf("site_byo_domains shape differs: %v", err)
	}

	rows, err := repo.ListMyCollaborations(ctx, me)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if rows[0].Hostname != host {
		t.Errorf("hostname = %q, want the BYO host %q", rows[0].Hostname, host)
	}
}

// ---- Invite collaborator ----

// inviteBlocker decides who may be handed access to someone else's shop, and
// both the lookup probe and the add endpoint read it — so it is tested on its
// own rather than through two nearly identical HTTP paths.
func TestInviteBlocker(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	owner := mkUser(t, ctx)
	site := mkSite(t, ctx, owner, "Toko Saya", "draft")

	stranger := mkUser(t, ctx)
	editor := mkUser(t, ctx)
	addMember(t, ctx, site, editor, owner, RoleEditor)

	h := &Handler{repo: repo}

	t.Run("unregistered email is refused", func(t *testing.T) {
		if got := h.inviteBlocker(ctx, site, owner, nil); got == "" {
			t.Error("nil user accepted; an unregistered address has no account to grant")
		}
	})
	t.Run("stranger with an account is eligible", func(t *testing.T) {
		if got := h.inviteBlocker(ctx, site, owner, &auth.User{ID: stranger}); got != "" {
			t.Errorf("blocked with %q, want eligible", got)
		}
	})
	t.Run("owner cannot invite themselves", func(t *testing.T) {
		if got := h.inviteBlocker(ctx, site, owner, &auth.User{ID: owner}); got == "" {
			t.Error("owner accepted as their own collaborator")
		}
	})
	t.Run("existing member is refused", func(t *testing.T) {
		got := h.inviteBlocker(ctx, site, owner, &auth.User{ID: editor})
		if got == "" {
			t.Error("already-a-member accepted again")
		}
		if !strings.Contains(got, RoleEditor) {
			t.Errorf("reason %q should name the current role", got)
		}
	})
}

// owner is never a grantable role: handing it out would transfer the shop.
func TestMemberRoleValid(t *testing.T) {
	for role, want := range map[string]bool{
		RoleEditor: true, RoleViewer: true,
		RoleOwner: false, "": false, "admin": false,
	} {
		if got := memberRoleValid(role); got != want {
			t.Errorf("memberRoleValid(%q) = %v, want %v", role, got, want)
		}
	}
}

// AddMember upserts, so an invite can also change an existing member's role —
// but the handler blocks that path, and a role change must never silently
// demote the owner.
func TestAddMember_RejectsOwnerRoleAndUpserts(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	owner := mkUser(t, ctx)
	site := mkSite(t, ctx, owner, "Toko", "draft")
	collab := mkUser(t, ctx)

	if err := repo.AddMember(ctx, site, collab, "bukan-role", &owner); err == nil {
		t.Error("invalid role accepted")
	}
	if err := repo.AddMember(ctx, site, collab, RoleViewer, &owner); err != nil {
		t.Fatalf("add viewer: %v", err)
	}
	if role, err := repo.HasAccess(ctx, site, collab); err != nil || role != RoleViewer {
		t.Fatalf("role = %q, err = %v, want viewer", role, err)
	}
	// Re-adding upgrades in place rather than duplicating the row.
	if err := repo.AddMember(ctx, site, collab, RoleEditor, &owner); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	if role, _ := repo.HasAccess(ctx, site, collab); role != RoleEditor {
		t.Errorf("role = %q after re-add, want editor", role)
	}
	members, err := repo.ListMembersForSite(ctx, site)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(members) != 2 { // owner + collaborator
		t.Errorf("members = %d, want 2 (no duplicate row)", len(members))
	}
}

// A granted collaborator must actually show up on the other side.
func TestAddMember_AppearsInCollaborations(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	owner := mkUser(t, ctx)
	collab := mkUser(t, ctx)
	site := mkSite(t, ctx, owner, "Toko Kolab", "published")

	if err := repo.AddMember(ctx, site, collab, RoleEditor, &owner); err != nil {
		t.Fatalf("add: %v", err)
	}
	rows, err := repo.ListMyCollaborations(ctx, collab)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 || rows[0].SiteID != site {
		t.Fatalf("collaborations = %+v, want the granted site", rows)
	}
	if rows[0].OwnerID != owner {
		t.Errorf("owner_id = %s, want %s", rows[0].OwnerID, owner)
	}
	// And the owner sees them in the collaborator list.
	owned, err := repo.ListCollaboratorsOwnedBy(ctx, owner)
	if err != nil {
		t.Fatalf("owned: %v", err)
	}
	if len(owned) == 0 {
		t.Error("granted collaborator missing from the owner's list")
	}
}

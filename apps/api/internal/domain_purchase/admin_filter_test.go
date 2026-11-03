package domain_purchase

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// mkRegisteredDomain inserts a row with an explicit registration date so the
// date-range boundaries can be exercised precisely.
func mkRegisteredDomain(t *testing.T, ctx context.Context, owner uuid.UUID, name string, registeredAt time.Time) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO registered_domains (user_id, name, status, registered_at)
		VALUES ($1, $2, 'active', $3)`,
		owner, name, registeredAt,
	); err != nil {
		t.Fatalf("insert registered_domain: %v", err)
	}
}

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// The range the admin picks is inclusive on both ends. A domain registered at
// any time on the "to" day must be included — the classic off-by-one here is
// comparing against midnight of that day and silently dropping it.
func TestAdminListDomains_CreatedRangeIsInclusive(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	owner := makeUser(t, ctx)
	tag := uuid.NewString()[:8]

	before := "before-" + tag + ".id"
	first := "first-" + tag + ".id"
	middle := "middle-" + tag + ".id"
	lastDay := "lastday-" + tag + ".id"
	after := "after-" + tag + ".id"

	mkRegisteredDomain(t, ctx, owner, before, day(2026, time.March, 9).Add(23*time.Hour))
	mkRegisteredDomain(t, ctx, owner, first, day(2026, time.March, 10))
	mkRegisteredDomain(t, ctx, owner, middle, day(2026, time.March, 12).Add(13*time.Hour))
	// Late on the final day — the case that breaks with an exclusive bound.
	mkRegisteredDomain(t, ctx, owner, lastDay, day(2026, time.March, 15).Add(23*time.Hour+59*time.Minute))
	mkRegisteredDomain(t, ctx, owner, after, day(2026, time.March, 16))

	from := day(2026, time.March, 10)
	to := day(2026, time.March, 16) // exclusive bound = 15th inclusive
	items, total, err := repo.AdminListDomains(ctx, AdminDomainFilter{
		Q: tag, CreatedFrom: &from, CreatedTo: &to, Page: 1, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	got := map[string]bool{}
	for _, it := range items {
		got[it.Name] = true
	}
	for _, want := range []string{first, middle, lastDay} {
		if !got[want] {
			t.Errorf("%s missing — it falls inside the range", want)
		}
	}
	for _, unwanted := range []string{before, after} {
		if got[unwanted] {
			t.Errorf("%s returned — it falls outside the range", unwanted)
		}
	}
	if total != 3 {
		t.Errorf("total = %d, want 3", total)
	}
}

// Each bound must work on its own; an admin often sets only one.
func TestAdminListDomains_OpenEndedRange(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	owner := makeUser(t, ctx)
	tag := uuid.NewString()[:8]

	old := "old-" + tag + ".id"
	recent := "recent-" + tag + ".id"
	mkRegisteredDomain(t, ctx, owner, old, day(2025, time.January, 1))
	mkRegisteredDomain(t, ctx, owner, recent, day(2026, time.June, 1))

	from := day(2026, time.January, 1)
	_, total, err := repo.AdminListDomains(ctx, AdminDomainFilter{
		Q: tag, CreatedFrom: &from, Page: 1, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("from-only: %v", err)
	}
	if total != 1 {
		t.Errorf("from-only total = %d, want 1 (only the recent one)", total)
	}

	to := day(2026, time.January, 1)
	_, total, err = repo.AdminListDomains(ctx, AdminDomainFilter{
		Q: tag, CreatedTo: &to, Page: 1, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("to-only: %v", err)
	}
	if total != 1 {
		t.Errorf("to-only total = %d, want 1 (only the old one)", total)
	}

	// No bounds at all = no date filtering.
	_, total, err = repo.AdminListDomains(ctx, AdminDomainFilter{Q: tag, Page: 1, PageSize: 100})
	if err != nil {
		t.Fatalf("unbounded: %v", err)
	}
	if total != 2 {
		t.Errorf("unbounded total = %d, want 2", total)
	}
}

// The date filter must compose with the others rather than replace them.
func TestAdminListDomains_DateCombinesWithStatus(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	owner := makeUser(t, ctx)
	tag := uuid.NewString()[:8]

	inRange := "active-" + tag + ".id"
	mkRegisteredDomain(t, ctx, owner, inRange, day(2026, time.April, 5))
	expired := "expired-" + tag + ".id"
	mkRegisteredDomain(t, ctx, owner, expired, day(2026, time.April, 6))
	if _, err := testPool.Exec(ctx,
		`UPDATE registered_domains SET status = 'expired' WHERE name = $1`, expired); err != nil {
		t.Fatalf("set status: %v", err)
	}

	from := day(2026, time.April, 1)
	to := day(2026, time.May, 1)
	_, total, err := repo.AdminListDomains(ctx, AdminDomainFilter{
		Q: tag, Status: "active", CreatedFrom: &from, CreatedTo: &to, Page: 1, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 1 {
		t.Errorf("total = %d, want 1 (status must still narrow the range)", total)
	}
}

// A malformed date must mean "no bound", never an accidental epoch filter that
// silently empties the table.
func TestParseDayStart(t *testing.T) {
	for _, bad := range []string{"", "   ", "10-03-2026", "2026/03/10", "besok", "2026-13-45"} {
		if got := parseDayStart(bad); got != nil {
			t.Errorf("parseDayStart(%q) = %v, want nil", bad, got)
		}
	}
	got := parseDayStart(" 2026-03-10 ")
	if got == nil {
		t.Fatal("valid date with surrounding spaces returned nil")
	}
	if !got.Equal(day(2026, time.March, 10)) {
		t.Errorf("parsed = %v, want midnight UTC on 2026-03-10", got)
	}
}

// adminDomainFilterFrom is the glue between the query string and the SQL: the
// list and the CSV both go through it, so a mistake here makes the export
// describe a different set of rows than the table.
func TestAdminDomainFilterFrom(t *testing.T) {
	capture := func(url string) AdminDomainFilter {
		t.Helper()
		var got AdminDomainFilter
		app := fiber.New()
		app.Get("/x", func(c *fiber.Ctx) error {
			got = adminDomainFilterFrom(c)
			return c.SendStatus(fiber.StatusOK)
		})
		if _, err := app.Test(httptest.NewRequest(http.MethodGet, url, nil), -1); err != nil {
			t.Fatalf("test request: %v", err)
		}
		return got
	}

	t.Run("created_to becomes the start of the next day", func(t *testing.T) {
		f := capture("/x?created_from=2026-03-10&created_to=2026-03-15")
		if f.CreatedFrom == nil || !f.CreatedFrom.Equal(day(2026, time.March, 10)) {
			t.Errorf("CreatedFrom = %v, want 2026-03-10 00:00 UTC", f.CreatedFrom)
		}
		// Exclusive upper bound = midnight on the 16th, so the whole 15th counts.
		if f.CreatedTo == nil || !f.CreatedTo.Equal(day(2026, time.March, 16)) {
			t.Errorf("CreatedTo = %v, want 2026-03-16 00:00 UTC", f.CreatedTo)
		}
	})

	t.Run("absent dates leave both bounds unset", func(t *testing.T) {
		f := capture("/x?q=toko")
		if f.CreatedFrom != nil || f.CreatedTo != nil {
			t.Errorf("bounds = %v/%v, want nil/nil", f.CreatedFrom, f.CreatedTo)
		}
		if f.Q != "toko" {
			t.Errorf("Q = %q, want toko", f.Q)
		}
	})

	t.Run("other filters still come through", func(t *testing.T) {
		f := capture("/x?status=active&expiring_days=30&without_site=true")
		if f.Status != "active" || f.ExpiringDays != 30 || !f.WithoutSite {
			t.Errorf("filter = %+v, want status/expiring/without_site preserved", f)
		}
	})
}

// Regression: the paged query resets any PageSize above 200 to 30. An export
// asking for 10000 therefore came back with 30 rows while reporting a much
// larger total — a short file that looks complete.
func TestAdminListDomains_ExportIgnoresPageCap(t *testing.T) {
	repo := needsDB(t)
	ctx := context.Background()
	owner := makeUser(t, ctx)
	tag := uuid.NewString()[:8]

	// Must exceed the 30-row fallback, or the broken behaviour would still
	// return every row and this test would pass against the bug it guards.
	const n = 35
	for i := 0; i < n; i++ {
		mkRegisteredDomain(t, ctx, owner,
			fmt.Sprintf("bulk-%d-%s.id", i, tag), day(2026, time.February, 1))
	}

	// Without the flag, an oversized page size falls back to the 30-row default.
	paged, total, err := repo.AdminListDomains(ctx, AdminDomainFilter{
		Q: tag, Page: 1, PageSize: AdminExportMaxRows,
	})
	if err != nil {
		t.Fatalf("paged: %v", err)
	}
	if total != n {
		t.Fatalf("total = %d, want %d", total, n)
	}
	if len(paged) != 30 {
		t.Errorf("paged returned %d rows, want the 30-row fallback to still apply", len(paged))
	}

	// With it, every matching row comes back.
	all, total, err := repo.AdminListDomains(ctx, AdminDomainFilter{
		Q: tag, Page: 1, PageSize: AdminExportMaxRows, Export: true,
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if len(all) != n {
		t.Errorf("export returned %d rows, want all %d", len(all), n)
	}
	if total != n {
		t.Errorf("total = %d, want %d", total, n)
	}
}

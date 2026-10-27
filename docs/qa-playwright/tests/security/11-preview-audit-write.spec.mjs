// 11-preview-audit-write.spec.mjs — Preview token HMAC isolation + audit log write verification.
//
// Baseline backend facts:
//   - POST /api/v1/pages/:id/preview-token → {token, expires_at, path}, TTL 1 hour
//   - GET /public/preview/:token → return page A only (claims.PageID lock)
//   - PATCH /api/v1/admin/users/:id/role body={role: 'user'|'admin'} → success + audit log entry
//     event="admin.user_promoted" atau "admin.user_demoted"
//     target_id = user promoted, actor_id = admin caller

import { test, expect } from "@playwright/test";
import { loginAs } from "../../fixtures/auth.mjs";
import { deriveApiBase } from "../../fixtures/accounts.mjs";
import { req, act } from "../../fixtures/qa.mjs";

const apiBase = deriveApiBase();

async function api(method, accessToken, path, body) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test.describe("A01 — Preview HMAC token isolation", () => {
  test("Preview token untuk page A TIDAK bisa akses page B (claims.PageID lock)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "Setup: create site + 2 pages (A, B). Issue preview token untuk page A. GET /public/preview/:tokenA → return page A (bukan B). Kalau backend cuma validate signature tanpa cek PageID di claims → attacker punya token 1 page bisa akses semua page site tsb (data leak).",
    );
    const { accessToken } = await loginAs(context, "admin");
    const siteRes = await api("POST", accessToken, "/api/v1/sites", {
      name: `QA Preview HMAC ${Date.now()}`,
      theme: {},
    });
    const site = (await siteRes.json()).data;

    try {
      // Page A dengan marker unik
      const markerA = `page-A-${Date.now()}`;
      const pageARes = await api("POST", accessToken, `/api/v1/sites/${site.id}/pages`, {
        slug: "page-a",
        title: "Page A",
        tree: { blocks: [{ type: "Heading", props: { text: markerA } }] },
        seo: {},
        is_home: true,
      });
      const pageA = (await pageARes.json()).data;

      // Page B dengan marker beda
      const markerB = `page-B-${Date.now()}`;
      const pageBRes = await api("POST", accessToken, `/api/v1/sites/${site.id}/pages`, {
        slug: "page-b",
        title: "Page B",
        tree: { blocks: [{ type: "Heading", props: { text: markerB } }] },
        seo: {},
        is_home: false,
      });
      const pageB = (await pageBRes.json()).data;

      // Issue token untuk page A
      const tokenARes = await api("POST", accessToken, `/api/v1/pages/${pageA.id}/preview-token`);
      expect(tokenARes.status).toBe(200);
      const tokenA = (await tokenARes.json()).data.token;
      expect(tokenA).toBeTruthy();

      // GET preview dengan token A — return page A
      const previewA = await fetch(`${apiBase}/public/preview/${tokenA}`);
      expect(previewA.status).toBe(200);
      const previewABody = await previewA.json();
      // Token A bisa access page A tree (marker A muncul)
      const treeStr = JSON.stringify(previewABody.data);
      expect(treeStr).toContain(markerA);
      expect(treeStr).not.toContain(markerB); // page B TIDAK ter-leak

      act(
        testInfo,
        `Token A (${tokenA.length} char) return page A dengan marker "${markerA.slice(-15)}", page B marker TIDAK ada di response — HMAC PageID lock verified`,
      );
    } finally {
      await api("DELETE", accessToken, `/api/v1/sites/${site.id}`).catch(() => {});
    }
  });

  test("Preview token invalid → 401/404 (bukan echo user data)", async ({}, testInfo) => {
    req(
      testInfo,
      "GET /public/preview/garbage-token-not-valid-hmac → HTTP 401/404. HMAC signature verify fail sebelum apapun. Kalau backend 500 = leak stack. Kalau 200 = HMAC broken.",
    );
    const res = await fetch(`${apiBase}/public/preview/garbage-token-not-valid-hmac-xyz`);
    expect([401, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
    act(testInfo, `HTTP ${res.status} — invalid HMAC token ditolak`);
  });
});

test.describe("A09 — Audit log write verified (mutation → entry created)", () => {
  test("Admin PATCH user role → audit log entry appear (non-destructive: admin→admin no-op)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      [
        "1) Login admin. Get admin user_id.",
        "2) Snapshot baseline: GET audit-log?target_id=<admin_id>&page_size=1 latest created_at.",
        "3) PATCH /admin/users/<admin_id>/role body={role:'admin'} — no-op state change, tapi tetap trigger audit event admin.user_promoted (backend event always fires).",
        "4) Wait 500ms (async write).",
        "5) GET audit-log?target_id=<admin_id> → items[0].created_at > baseline, event='admin.user_promoted', actor_email = admin, target_id = admin_id.",
      ].join(" "),
    );
    const { accessToken: adminToken } = await loginAs(context, "admin");

    // Get admin user id (target = admin itself, no-op mutation)
    const usersRes = await api(
      "GET",
      adminToken,
      `/api/v1/admin/users?q=${encodeURIComponent(process.env.ADMIN_EMAIL || "admin@example.com")}`,
    );
    const adminUser = (await usersRes.json()).data.items[0];
    expect(adminUser).toBeTruthy();
    const targetId = adminUser.id;

    // Baseline audit log latest entry for this target
    const baselineRes = await api(
      "GET",
      adminToken,
      `/api/v1/admin/audit-log?target_id=${targetId}&page_size=1`,
    );
    const baseline = (await baselineRes.json()).data;
    const baselineTime =
      baseline.items[0]?.created_at || "1970-01-01T00:00:00Z";

    // Trigger no-op role change (admin → admin — no state change tapi event tetap fire)
    const patchRes = await api(
      "PATCH",
      adminToken,
      `/api/v1/admin/users/${targetId}/role`,
      { role: "admin" },
    );
    expect(patchRes.status).toBe(200);

    // Beri waktu audit log write (fire-and-forget goroutine)
    await new Promise((r) => setTimeout(r, 800));

    // Verify audit entry appear post-baseline
    const auditRes = await api(
      "GET",
      adminToken,
      `/api/v1/admin/audit-log?target_id=${targetId}&page_size=5`,
    );
    const audit = (await auditRes.json()).data;
    expect(audit.items.length).toBeGreaterThan(0);

    const latest = audit.items[0];
    // Fresh entry: created_at > baseline
    expect(new Date(latest.created_at).getTime()).toBeGreaterThan(
      new Date(baselineTime).getTime(),
    );
    expect(latest.target_id).toBe(targetId);
    expect(latest.event).toMatch(/admin\.user_(promoted|demoted)/);
    expect(latest.actor_email).toBeTruthy();
    // Actor = admin who triggered (bukan system) — admin email match caller
    expect(latest.actor_email.toLowerCase()).toBe(
      (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase(),
    );

    act(
      testInfo,
      `Baseline latest=${baselineTime.slice(0, 19)}, post-PATCH event="${latest.event}", actor="${latest.actor_email}", target=${latest.target_id.slice(0, 8)}..., created_at=${latest.created_at.slice(0, 19)} — fresh entry verified`,
    );
  });
});

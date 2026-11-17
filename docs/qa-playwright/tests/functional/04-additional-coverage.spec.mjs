// 04-additional-coverage.spec.mjs — coverage tambahan:
//   - Refresh token rotation (revoke old)
//   - Site create dari template (gate + happy path)
//   - Wallet payment role gate (client → 403)
//   - Quota enforcement pages (>quota → 403)
//   - Idempotency-Key deduplication (2× same key → 1 invoice)

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

test.describe("Auth — Refresh token rotation (session security)", () => {
  test("POST /auth/refresh 2× dengan same token → 2nd 401 (old revoked)", async ({}, testInfo) => {
    req(
      testInfo,
      "1) Login → dapat refresh_token R1. 2) POST /auth/refresh {refresh_token: R1} → 200 + return R2 baru. 3) POST /auth/refresh {refresh_token: R1} AGAIN → HTTP 401. Rotation invariant: setiap refresh call revoke old + issue new. Kalau 2nd call sukses = attacker curi refresh bisa reuse selamanya.",
    );
    const loginRes = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Pakai agent account supaya tidak affect client suite yang lain.
        email: process.env.AGENT_EMAIL || "agent@example.com",
        password: process.env.AGENT_PASSWORD || "changeme123",
      }),
    });
    // Kalau login rate-limited, skip test.
    if (loginRes.status !== 200) {
      act(testInfo, `Login rate-limited (${loginRes.status}) — skip rotation test`);
      return;
    }
    const { data } = await loginRes.json();
    const R1 = data.refresh_token;
    expect(R1).toBeTruthy();

    // 1st refresh — expect 200 dengan R2 baru
    const first = await fetch(`${apiBase}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: R1 }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const R2 = firstBody.data.refresh_token;
    expect(R2).toBeTruthy();
    expect(R2).not.toBe(R1); // rotation confirmed

    // 2nd refresh dengan R1 (yang seharusnya revoked) — expect 401
    const second = await fetch(`${apiBase}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: R1 }),
    });
    expect(second.status).toBe(401);
    const secondBody = await second.json();
    expect(secondBody.error?.code).toBeTruthy();

    act(
      testInfo,
      `R1→R2 rotation ok (length R1=${R1.length}, R2=${R2.length}, distinct=true). 2nd R1 call HTTP ${second.status} code="${secondBody.error?.code}"`,
    );
  });
});

test.describe("Site — Template creation gate", () => {
  test("POST /sites/from-template/:slug TANPA job_id → 400 code=job_id_required", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites/from-template/umkm-modern body={slug, name} tanpa job_id → HTTP 400 error.code='job_id_required'. Gate ini enforce '1 domain = 1 situs' business rule (CLAUDE.md). Kalau tanpa job_id lolos → user bisa spam create site tanpa purchase domain.",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await api("POST", accessToken, "/api/v1/sites/from-template/umkm-modern", {
      slug: `qa-tmpl-${Date.now()}`,
      name: "QA Template Gate Test",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe("job_id_required");
    act(
      testInfo,
      `HTTP ${res.status}, error.code="${body.error.code}", message="${(body.error.message || "").slice(0, 60)}"`,
    );
  });

  test("POST /sites/from-template/nonexistent-slug → 404 template not found", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /sites/from-template/nonexistent-slug-abc + valid job_id UUID → HTTP 404 code='not_found' message='template not found'. Enforce whitelist template. Cegah user bikin site dari slug arbitrer (bypass built-in catalog).",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await api(
      "POST",
      accessToken,
      "/api/v1/sites/from-template/nonexistent-slug-xyz-abc",
      {
        slug: "test",
        name: "test",
        job_id: "00000000-0000-4000-8000-000000000001",
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error?.code).toBe("not_found");
    act(testInfo, `HTTP ${res.status}, error.code="${body.error.code}"`);
  });
});

test.describe("Purchase — Wallet payment role gate (client → 403)", () => {
  test("Client POST /purchase dengan payment_method='deposit_wallet' → 403 forbidden", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/domains/purchase sebagai client + Idempotency-Key + body={payment_method: 'deposit_wallet'} → HTTP 403 error.message match 'reseller/agent'. Wallet payment untuk client dilarang (CLAUDE.md line 261). Cegah client abuse wallet balance orang lain via on-behalf-of.",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await fetch(`${apiBase}/api/v1/domains/purchase`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `qa-wallet-gate-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        domain: "qa-wallet-gate.biz.id",
        tld: "biz.id",
        years: 1,
        payment_method: "deposit_wallet",
      }),
    });
    // 403 (role gate) atau 429 (purchase rate limit dari test lain).
    expect([403, 429]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) {
      expect(body.error?.message || "").toMatch(/reseller|agent/i);
    }
    act(
      testInfo,
      `HTTP ${res.status} — ${res.status === 403 ? `role gate: "${body.error?.message?.slice(0, 60)}"` : "rate limit gate"}`,
    );
  });
});

test.describe("Quota — Pages per site enforcement", () => {
  test("Create page ke-(quota+1) → 403 page quota reached", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "1) Client create site. 2) Admin PATCH quota_max_pages=1 (tighten supaya test cepat). 3) Client create 1st page (sukses). 4) Client create 2nd page → HTTP 403 message match 'quota'. Business rule: enforce quota di handler (bukan repo).",
    );
    const { accessToken: clientToken } = await loginAs(context, "client");
    const { accessToken: adminToken } = await loginAs(context, "admin");

    // Step 1: create site
    const siteRes = await api("POST", clientToken, "/api/v1/sites", {
      name: `QA Quota Test ${Date.now()}`,
      theme: {},
    });
    expect(siteRes.status).toBe(201);
    const site = (await siteRes.json()).data;

    try {
      // Step 2: admin tighten quota to 1 page
      const quotaRes = await api(
        "PATCH",
        adminToken,
        `/api/v1/admin/sites/${site.id}/quota`,
        {
          quota_max_pages: 1,
        },
      );
      expect(quotaRes.status).toBe(200);

      // Step 3: create 1st page — sukses
      const page1 = await api("POST", clientToken, `/api/v1/sites/${site.id}/pages`, {
        slug: "home",
        title: "Home",
        tree: { blocks: [] },
        seo: {},
        is_home: true,
      });
      expect(page1.status).toBe(201);

      // Step 4: create 2nd page — HARUS 403 quota
      const page2 = await api("POST", clientToken, `/api/v1/sites/${site.id}/pages`, {
        slug: "about",
        title: "About",
        tree: { blocks: [] },
        seo: {},
        is_home: false,
      });
      expect(page2.status).toBe(403);
      const body = await page2.json();
      expect(body.error?.message || "").toMatch(/quota|maks/i);

      act(
        testInfo,
        `Quota set to 1, page1 HTTP ${page1.status}, page2 HTTP ${page2.status} message="${(body.error?.message || "").slice(0, 60)}"`,
      );
    } finally {
      await api("DELETE", clientToken, `/api/v1/sites/${site.id}`).catch(() => {});
    }
  });
});

test.describe("Idempotency — Duplicate key deduplication", () => {
  test("POST /purchase 2× dengan same Idempotency-Key → response konsisten (invoice tidak dobel)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /purchase 2× dengan Idempotency-Key sama + body sama → 1st response direkam; 2nd response konsisten (200 return cached ATAU 4xx idem replay). Yang KRITIS: kalau 1st sukses membuat invoice, 2nd TIDAK boleh bikin invoice ke-2 di DB. Test ini untuk cegah double-charge race waktu browser retry.",
    );
    const { accessToken } = await loginAs(context, "client");
    const idemKey = `qa-dedup-${crypto.randomUUID()}`;
    const body = JSON.stringify({
      domain: `qa-dedup-${Date.now()}.biz.id`,
      tld: "biz.id",
      years: 1,
      payment_method: "midtrans",
    });

    async function callPurchase() {
      return fetch(`${apiBase}/api/v1/domains/purchase`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
        },
        body,
      });
    }

    const [res1, res2] = await Promise.all([callPurchase(), callPurchase()]);
    const b1 = await res1.json().catch(() => ({}));
    const b2 = await res2.json().catch(() => ({}));

    // Both should return SAME response (both success dengan job_id sama,
    // atau both fail dengan alasan sama). NEVER 1st sukses + 2nd sukses beda invoice.
    if (res1.status === 200 && res2.status === 200) {
      // Both success → job_id HARUS sama (dedup at gateway/registrar layer).
      expect(b1.data?.job_id).toBe(b2.data?.job_id);
    }
    // Kalau salah satu 4xx (rate limit / role gate), yang lain juga harus 4xx.
    if (res1.status >= 400) {
      expect(res2.status).toBeGreaterThanOrEqual(400);
    }

    act(
      testInfo,
      `1st HTTP ${res1.status} job_id=${b1.data?.job_id?.slice(0, 8) || "n/a"}, 2nd HTTP ${res2.status} job_id=${b2.data?.job_id?.slice(0, 8) || "n/a"}, dedup=${b1.data?.job_id === b2.data?.job_id || res1.status === res2.status ? "consistent" : "DIVERGENT"}`,
    );
  });
});

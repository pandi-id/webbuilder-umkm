// 13-server-hardening.spec.mjs — Server-level hardening.
// OWASP A05 (security misconfiguration).
//
// Baseline backend facts (verified via curl):
//   - /debug/pprof → 404 (dev pun tidak enabled — good)
//   - Error handling: httpx.Err() → JSON envelope, tidak leak stack

import { test, expect } from "@playwright/test";
import { loginAs } from "../../fixtures/auth.mjs";
import { deriveApiBase } from "../../fixtures/accounts.mjs";
import { req, act } from "../../fixtures/qa.mjs";

const apiBase = deriveApiBase();

test.describe("A05 — Server debug endpoint hardening", () => {
  test("/debug/pprof → 404 (bukan enabled di production)", async ({}, testInfo) => {
    req(
      testInfo,
      "GET /debug/pprof → HTTP 404. Go pprof default expose heap/goroutine/cpu profile — kalau attacker akses bisa fingerprint runtime + potential DoS (heap dump huge). Backend HARUS tidak mount pprof di public router (gunakan admin-only atau localhost bind).",
    );
    const res = await fetch(`${apiBase}/debug/pprof/`);
    expect(res.status).toBe(404);
    act(testInfo, `HTTP ${res.status} — pprof tidak accessible di public router`);
  });

  test("/debug/vars, /debug/expvar → 404 (Go runtime info tidak leak)", async ({}, testInfo) => {
    req(
      testInfo,
      "GET /debug/vars → HTTP 404. expvar default expose memory + gc stats + cmdline. Kalau lolos → attacker profile runtime version + patch level → target CVE.",
    );
    const res = await fetch(`${apiBase}/debug/vars`);
    expect(res.status).toBe(404);
    act(testInfo, `HTTP ${res.status} — expvar tidak accessible`);
  });
});

test.describe("A05 — Error 500 no stack leak (dedicated test)", () => {
  test("Malformed JSON body (extreme size) → 400 tanpa Go panic stack", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites body = 100 KB random bytes (bukan JSON) → HTTP 400. Body response HARUS tidak mengandung 'goroutine|panic|runtime.gopanic|/apps/api/' path. Kalau leak → attacker profile deployment path + Go version. Ini test paling penting untuk misconfig 500 handler.",
    );
    const { accessToken } = await loginAs(context, "client");
    // Random binary bytes 100 KB — should crash BodyParser
    const junk = Buffer.alloc(100_000).fill(0xff);
    const res = await fetch(`${apiBase}/api/v1/sites`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: junk,
    });
    // 400 (parser fail) atau 413 (payload too large) — dua-duanya OK
    expect(res.status).not.toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const bodyText = await res.text();
    const bodyLower = bodyText.toLowerCase();
    expect(bodyLower).not.toMatch(/goroutine|panic|runtime\.gopanic|\/apps\/api\/|pgx/);

    act(
      testInfo,
      `HTTP ${res.status}, body length=${bodyText.length}, no stack/path leak (no 'goroutine' 'panic' 'pgx' pattern)`,
    );
  });

  test("Path parameter dengan encoding aneh → tidak trigger 500 dengan stack", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "GET /api/v1/sites/%00%FF%FE%00 (invalid UTF-8 + null bytes) → HTTP 400/404. Tidak boleh 500 dengan panic trace. Backend router harus normalize atau fail-soft.",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await fetch(
      `${apiBase}/api/v1/sites/%00%FF%FE%00`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status).not.toBe(500);
    const bodyText = await res.text();
    expect(bodyText.toLowerCase()).not.toMatch(/goroutine|panic/);
    act(testInfo, `HTTP ${res.status}, body length=${bodyText.length}, no panic leak`);
  });
});

test.describe("A02 — Preview HMAC token entropy + expiry", () => {
  test("Preview token entropy — length ≥ 100 char + base64url charset", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /pages/:id/preview-token → response.token panjang ≥ 100 char (JWT typical) dan match base64url charset [A-Za-z0-9._-]. Kalau token pendek atau predictable → brute-force possible.",
    );
    const { accessToken } = await loginAs(context, "client");
    const siteRes = await fetch(`${apiBase}/api/v1/sites`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `QA HMAC Entropy ${Date.now()}`, theme: {} }),
    });
    const site = (await siteRes.json()).data;
    try {
      const pageRes = await fetch(`${apiBase}/api/v1/sites/${site.id}/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: "home",
          title: "H",
          tree: { blocks: [] },
          seo: {},
          is_home: true,
        }),
      });
      const page = (await pageRes.json()).data;

      const tokenRes = await fetch(
        `${apiBase}/api/v1/pages/${page.id}/preview-token`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      const { token, expires_at } = (await tokenRes.json()).data;
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThanOrEqual(100);
      // JWT format: header.payload.signature — semua base64url
      expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(token.split(".").length).toBe(3);

      // Verify expires_at valid ISO string within future ~1 hour
      const expMs = new Date(expires_at).getTime();
      const nowMs = Date.now();
      const ttlMinutes = (expMs - nowMs) / 60_000;
      // TTL 1 jam per spec — allow 55-65 minute tolerance
      expect(ttlMinutes).toBeGreaterThan(50);
      expect(ttlMinutes).toBeLessThan(70);

      act(
        testInfo,
        `token length=${token.length}, base64url charset ok, JWT 3-segment ok, TTL=${ttlMinutes.toFixed(1)} minutes`,
      );
    } finally {
      await fetch(`${apiBase}/api/v1/sites/${site.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  });

  test("Preview token dengan signature tampered → 401 (verify HMAC)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "Ambil valid preview token → flip 1 char di signature segment → GET /public/preview/:tamperedToken → HTTP 401/404. HMAC verify pass integrity check.",
    );
    const { accessToken } = await loginAs(context, "client");
    const site = (await (await fetch(`${apiBase}/api/v1/sites`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `QA HMAC Tamper ${Date.now()}`, theme: {} }),
    })).json()).data;

    try {
      const page = (await (await fetch(`${apiBase}/api/v1/sites/${site.id}/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: "home",
          title: "H",
          tree: { blocks: [] },
          seo: {},
          is_home: true,
        }),
      })).json()).data;

      const { token } = (await (await fetch(
        `${apiBase}/api/v1/pages/${page.id}/preview-token`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      )).json()).data;

      // Flip last char of signature segment
      const parts = token.split(".");
      const sig = parts[2];
      const flipped = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
      const tampered = `${parts[0]}.${parts[1]}.${flipped}`;

      const res = await fetch(`${apiBase}/public/preview/${tampered}`);
      expect([401, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);

      act(testInfo, `HTTP ${res.status} — tampered HMAC signature ditolak`);
    } finally {
      await fetch(`${apiBase}/api/v1/sites/${site.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  });
});

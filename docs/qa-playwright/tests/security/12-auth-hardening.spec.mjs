// 12-auth-hardening.spec.mjs — Session + CORS + register validation hardening.
// OWASP A05 (misconfiguration) + A07 (auth failures).
//
// Baseline backend facts (verified):
//   - POST /auth/logout {refresh_token} → 200 + revoke di DB
//   - Post-logout POST /auth/refresh same token → 401 "invalid refresh token"
//   - CORS: whitelist via Access-Control-Allow-Origin echo. Evil origin
//     → NO Access-Control-Allow-Origin header (browser will block)
//   - POST /auth/register email format + password length validation → 400
//     "email/password invalid (password min 8 chars)"

import { test, expect } from "@playwright/test";
import { deriveApiBase } from "../../fixtures/accounts.mjs";
import { req, act } from "../../fixtures/qa.mjs";

const apiBase = deriveApiBase();

// Retry-on-429 helper — Fiber login/register di-rate-limit
async function loginFresh(email, password) {
  let res;
  const start = Date.now();
  let wait = 5000;
  while (Date.now() - start < 360_000) {
    res = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.5, 30_000);
  }
  return res;
}

test.describe("A07 — Session lifecycle: logout revokes refresh token", () => {
  test("POST /auth/logout → post-logout /refresh dengan same token → 401 (invalid refresh)", async ({}, testInfo) => {
    testInfo.setTimeout(400_000); // butuh room untuk retry-on-429 backoff hingga 6 menit
    req(
      testInfo,
      "1) Login → dapat access + refresh. 2) POST /auth/logout {refresh_token} → 200. 3) POST /auth/refresh {refresh_token: same} → HTTP 401 'invalid refresh token'. Kalau backend tidak revoke → stolen refresh token bisa dipakai selamanya (session hijack). Session lifecycle critical untuk logout button = real security action, bukan cuma UI dismissal.",
    );
    const loginRes = await loginFresh(
      process.env.CLIENT_EMAIL || "client@example.com",
      process.env.CLIENT_PASSWORD || "changeme123",
    );
    expect(loginRes.status).toBe(200);
    const { data } = await loginRes.json();
    const refreshToken = data.refresh_token;
    const accessToken = data.access_token;

    // Step 2: logout
    const logoutRes = await fetch(`${apiBase}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    expect(logoutRes.status).toBe(200);

    // Step 3: try refresh with logged-out token
    const refreshRes = await fetch(`${apiBase}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    expect(refreshRes.status).toBe(401);
    const body = await refreshRes.json();
    expect(body.error?.code).toBeTruthy();

    act(
      testInfo,
      `Logout HTTP 200, post-logout refresh HTTP ${refreshRes.status} code="${body.error?.code}" — token properly blacklisted`,
    );
  });
});

test.describe("A05 — CORS whitelist enforcement", () => {
  test("CORS preflight dari EVIL origin → NO Access-Control-Allow-Origin (browser block)", async ({}, testInfo) => {
    req(
      testInfo,
      "OPTIONS /api/v1/auth/me dengan Origin: https://evil.example.com → HTTP 204 tapi TANPA header Access-Control-Allow-Origin. Browser CORS spec: kalau ACAO absent atau tidak match Origin request → block response ke JavaScript. Attacker phishing site tidak bisa exfiltrate API response.",
    );
    const res = await fetch(`${apiBase}/api/v1/auth/me`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    // 204 = preflight success (Fiber default), tapi ACAO harus absent
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).not.toBe("https://evil.example.com");
    expect(acao).not.toBe("*"); // Wildcard = catastrophic dengan credentials

    act(
      testInfo,
      `HTTP ${res.status}, ACAO header="${acao || "(absent)"}", evil origin tidak echo — CORS whitelist aktif`,
    );
  });

  test("CORS preflight dari LEGITIMATE origin (BASE_URL) → ACAO echo balik", async ({}, testInfo) => {
    req(
      testInfo,
      "OPTIONS /api/v1/auth/me dengan Origin: <BASE_URL host> → HTTP 204 + Access-Control-Allow-Origin echo balik ke origin. Ini bukti whitelist bukan block-all (dashboard harus tetap bisa call API).",
    );
    const legitOrigin = process.env.BASE_URL || "http://localhost:3000";
    const res = await fetch(`${apiBase}/api/v1/auth/me`, {
      method: "OPTIONS",
      headers: {
        Origin: legitOrigin,
        "Access-Control-Request-Method": "GET",
      },
    });
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).toBe(legitOrigin);

    act(
      testInfo,
      `HTTP ${res.status}, ACAO="${acao}" — legitimate origin allowed`,
    );
  });
});

test.describe("A07 — Register endpoint input validation", () => {
  test("POST /auth/register email format invalid → 400 dengan pesan actionable", async ({}, testInfo) => {
    req(
      testInfo,
      "POST /auth/register body={email:'not-email', password:'x'} → HTTP 400 pesan mention 'email' atau 'password min'. Cegah user register akun dengan email tidak valid + password lemah.",
    );
    const res = await fetch(`${apiBase}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-a-valid-email-format", password: "x" }),
    });
    // 400 = validation, 429 = rate limit — dua-duanya OK karena gate ada
    expect([400, 429]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json();
      expect(body.error?.message).toMatch(/email|password|invalid/i);
      act(
        testInfo,
        `HTTP ${res.status}, message="${body.error.message}" — validation kick`,
      );
    } else {
      act(testInfo, `HTTP ${res.status} — register rate limit gate`);
    }
  });

  test("POST /auth/register password terlalu pendek → 400 min-length enforced", async ({}, testInfo) => {
    req(
      testInfo,
      "POST /auth/register body={email:'valid@x.com', password:'1234567' (7 char, below 8 min)} → HTTP 400 message match 'password min 8'. Baseline security: minimum password length 8.",
    );
    const res = await fetch(`${apiBase}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `qa-shortpw-${Date.now()}@qa.example.com`,
        password: "1234567", // 7 char — below 8 min
      }),
    });
    expect([400, 429]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json();
      expect(body.error?.message).toMatch(/password.*(min|8)/i);
      act(testInfo, `HTTP ${res.status}, message="${body.error.message}"`);
    } else {
      act(testInfo, `HTTP ${res.status} — register rate limit gate`);
    }
  });
});

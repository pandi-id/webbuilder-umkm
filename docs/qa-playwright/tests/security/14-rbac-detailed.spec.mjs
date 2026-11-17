// 14-rbac-detailed.spec.mjs — Detailed RBAC + audit log write (OWASP A01/A09).
//
// Baseline backend facts:
//   - Reseller/agent /reseller/clients endpoints — ownership via reseller_id filter
//   - Login failure (invalid credential) → audit log entry? Depends on backend
//   - Agent purchase on-behalf-of tanpa assignment → 403 (auth.CanRegisterForClient)

import { test, expect } from "@playwright/test";
import { loginAs } from "../../fixtures/auth.mjs";
import { deriveApiBase } from "../../fixtures/accounts.mjs";
import { req, act } from "../../fixtures/qa.mjs";

const apiBase = deriveApiBase();

async function api(method, accessToken, path, body, extraHeaders = {}) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test.describe("A01 — Detailed cross-tenant RBAC", () => {
  test("Reseller GET /reseller/clients/:random_uuid → 404 (bukan client kelolaannya)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "GET /api/v1/reseller/clients/<random-uuid-bukan-milik-caller> sebagai reseller → HTTP 404. Ownership filter di repo (WHERE reseller_id = current) HARUS return NOT FOUND untuk client lain, cegah enumeration attack.",
    );
    const { accessToken } = await loginAs(context, "reseller");
    const randomUuid = "aaaaaaaa-bbbb-4ccc-8ddd-000000000042";
    const res = await api("GET", accessToken, `/api/v1/reseller/clients/${randomUuid}`);
    // 404 = ideal (ownership filter). 403 = leaky (attacker tahu resource exist).
    expect(res.status).toBe(404);
    act(testInfo, `HTTP ${res.status} — cross-reseller client access blocked`);
  });

  test("Client role TIDAK boleh on-behalf-of purchase → 403 (CanRegisterForClient rule)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/domains/purchase sebagai CLIENT + body.on_behalf_of_user_id=<any-uuid> → HTTP 403 message match 'reseller/agent'. auth.CanRegisterForClient() rule: hanya role reseller/agent yang bisa purchase on-behalf. Cegah client role bypass wallet payment gate via on-behalf-of trick.",
    );
    const { accessToken } = await loginAs(context, "client");
    const orphanClientUuid = "aaaaaaaa-bbbb-4ccc-8ddd-000000000099";
    const res = await api(
      "POST",
      accessToken,
      "/api/v1/domains/purchase",
      {
        domain: "qa-onbehalf-client.biz.id",
        tld: "biz.id",
        years: 1,
        payment_method: "midtrans",
        on_behalf_of_user_id: orphanClientUuid,
      },
      { "Idempotency-Key": `qa-onbehalf-${crypto.randomUUID()}` },
    );
    expect([403, 400, 429]).toContain(res.status);
    expect(res.status).not.toBe(200);
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) {
      expect(body.error?.message || "").toMatch(/reseller|agent/i);
    }
    act(
      testInfo,
      `HTTP ${res.status}, code="${body.error?.code || "n/a"}" — on-behalf-of client role denied`,
    );
  });
});

test.describe("A09 — Login failure logged (audit log fresh entry post-failure)", () => {
  test("Failed login → audit log OR business decision no-log (dokumentasi behavior)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "Snapshot audit-log latest. Trigger failed login dengan email valid + password salah → HTTP 401. Wait 500ms. Query audit-log fresh entries. Backend policy: kalau log fail attempts di audit-log = ideal (attack detection). Kalau tidak = dokumentasi gap (rely on Fiber log). Test PASS baik ada entry atau tidak — yang penting NEVER 500.",
    );
    const { accessToken: adminToken } = await loginAs(context, "admin");

    // Snapshot baseline (latest audit entry timestamp)
    const baselineRes = await api("GET", adminToken, "/api/v1/admin/audit-log?page_size=1");
    const baseline = (await baselineRes.json()).data;
    const baselineTime = baseline.items[0]?.created_at || "1970-01-01T00:00:00Z";

    // Trigger failed login
    const failRes = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.CLIENT_EMAIL || "client@example.com",
        password: "definitely-wrong-qa-password",
      }),
    });
    // 401 (unauthorized) atau 429 (rate limit) — dua-duanya OK
    expect([401, 429]).toContain(failRes.status);

    // Wait fire-and-forget async write
    await new Promise((r) => setTimeout(r, 800));

    // Check audit log for fresh entry
    const afterRes = await api(
      "GET",
      adminToken,
      "/api/v1/admin/audit-log?page_size=10",
    );
    const after = (await afterRes.json()).data;
    const hasFreshEntry = after.items.some(
      (e) => new Date(e.created_at).getTime() > new Date(baselineTime).getTime(),
    );
    const authFailEntry = after.items.find(
      (e) =>
        new Date(e.created_at).getTime() > new Date(baselineTime).getTime() &&
        /auth|login|fail/i.test(e.event),
    );

    const summary = authFailEntry
      ? `LOGGED: event="${authFailEntry.event}" post-baseline`
      : hasFreshEntry
        ? "FRESH entry exists tapi bukan auth event (dokumentasi: audit log flow lain)"
        : "GAP: failed login TIDAK ke-log audit (rely on Fiber access log — consider adding untuk brute-force detection)";
    act(testInfo, `Baseline=${baselineTime.slice(0, 19)}, failed login HTTP ${failRes.status}, ${summary}`);
  });
});

test.describe("Promo — Validate endpoint gate", () => {
  test("POST /promos/validate dengan kode invalid → 400/404 (bukan silent accept)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/promos/validate body={code:'NONEXISTENT-QA-CODE'} → HTTP 400/404 error.code menunjukkan 'not found' atau 'invalid'. Cegah silent accept promo palsu di UI (user apply → assume 0 discount → confused).",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await api("POST", accessToken, "/api/v1/promos/validate", {
      code: "NONEXISTENT-QA-CODE-XYZ-999",
      tld: "biz.id",
      kind: "register",
      subtotal: 100000,
    });
    // Bisa 400/404 tergantung backend
    expect([400, 404]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    act(
      testInfo,
      `HTTP ${res.status}, code="${body.error?.code || "n/a"}" — invalid promo ditolak (bukan silent 0-discount)`,
    );
  });

  test("POST /promos/validate tanpa body → 400 validation", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /promos/validate dengan body kosong '' → HTTP 400. Validation shape check.",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await fetch(`${apiBase}/api/v1/promos/validate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "",
    });
    expect(res.status).toBe(400);
    act(testInfo, `HTTP ${res.status} — validation kick untuk empty body`);
  });
});

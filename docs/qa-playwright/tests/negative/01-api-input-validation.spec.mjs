// 01-api-input-validation.spec.mjs — Dedicated negative tests untuk API input validation.
//
// Verified backend behavior (probed via curl):
//   - Malformed JSON body → 400 error.code="bad_request" message="invalid json"
//   - Missing required field (name) → 400 message="name required"
//   - Wrong field type (name: 123) → 400 message="invalid json" (Go BodyParser fail)
//   - Invalid UUID di path → 400 message="invalid id"
//   - Wrong Content-Type → 400 (parse fail)
//   - No Content-Type → 400 "name required" (parse empty struct)

import { test, expect } from "@playwright/test";
import { loginAs } from "../../fixtures/auth.mjs";
import { deriveApiBase } from "../../fixtures/accounts.mjs";
import { req, act } from "../../fixtures/qa.mjs";

const apiBase = deriveApiBase();

async function api(method, accessToken, path, opts = {}) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    body: opts.body,
  });
}

test.describe("Negative — Domain-less site create is admin-only", () => {
  test("POST /sites sebagai client → 403 (situs wajib lewat beli domain)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites membuat situs TANPA domain — hanya untuk admin (QA/support). Client wajib lewat POST /sites/from-template/:slug dengan job_id domain yang sudah dibayar (1 domain = 1 situs). Client → HTTP 403, tidak ada situs dibuat.",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await api("POST", accessToken, "/api/v1/sites", {
      body: JSON.stringify({ name: `client-bypass-${Date.now()}` }),
    });
    expect(res.status).toBe(403);
    act(testInfo, `HTTP ${res.status} — client tidak bisa membuat situs tanpa domain`);
  });
});

test.describe("Negative — Malformed request body", () => {
  test("POST /sites dengan JSON syntax rusak → 400 'invalid json'", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites body='{invalid json' → HTTP 400 error.code='bad_request' message='invalid json'. Backend BodyParser fail-safe reject sebelum handler execute. Kalau lolos → panic/500 = leak stack.",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("POST", accessToken, "/api/v1/sites", {
      body: "{invalid json syntax here",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe("bad_request");
    expect(body.error?.message).toMatch(/invalid json/i);
    act(
      testInfo,
      `HTTP ${res.status}, error.code="${body.error.code}", message="${body.error.message}"`,
    );
  });

  test("POST /sites tanpa body → 400 'name required' (empty struct parse)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites body='' (empty) → HTTP 400 message='name required'. Backend parse empty ke struct default → validation kick 'name required'. Bukan 500 / panic.",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("POST", accessToken, "/api/v1/sites", {
      body: "",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe("bad_request");
    act(testInfo, `HTTP ${res.status}, message="${body.error.message}"`);
  });

  test("POST /sites dengan Content-Type: text/plain → 400", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites Content-Type=text/plain + valid JSON body → HTTP 400. Backend enforce Content-Type match sebelum parse. Cegah content-type confusion attack (upload polyglot dengan multipart).",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("POST", accessToken, "/api/v1/sites", {
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ name: "test", theme: {} }),
    });
    expect(res.status).toBe(400);
    act(testInfo, `HTTP ${res.status} — content-type mismatch ditolak`);
  });
});

test.describe("Negative — Missing required fields", () => {
  test("POST /sites tanpa 'name' field → 400 'name required'", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites body={theme:{}} — omit required 'name' → HTTP 400 error.code='bad_request' message match 'name required'.",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("POST", accessToken, "/api/v1/sites", {
      body: JSON.stringify({ theme: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/name.*required/i);
    act(testInfo, `HTTP ${res.status}, message="${body.error.message}"`);
  });

  test("POST /pages tanpa 'slug' → 400 (slug required)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "Setup site dulu, POST /sites/:id/pages body={title, tree, is_home:true} tanpa 'slug' → HTTP 400. Slug adalah URL segment, mandatory untuk routing.",
    );
    const { accessToken } = await loginAs(context, "admin");
    // Create site first
    const siteRes = await api("POST", accessToken, "/api/v1/sites", {
      body: JSON.stringify({ name: `Negative Slug Test ${Date.now()}`, theme: {} }),
    });
    const site = (await siteRes.json()).data;
    try {
      const res = await api("POST", accessToken, `/api/v1/sites/${site.id}/pages`, {
        body: JSON.stringify({
          title: "No Slug",
          tree: { blocks: [] },
          seo: {},
          is_home: true,
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      act(
        testInfo,
        `HTTP ${res.status}, message="${body.error?.message || "n/a"}"`,
      );
    } finally {
      await api("DELETE", accessToken, `/api/v1/sites/${site.id}`).catch(() => {});
    }
  });
});

test.describe("Negative — Wrong field types", () => {
  test("POST /sites dengan name = number → 400 (BodyParser type mismatch)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites body={name: 123, theme: {}} → HTTP 400 'invalid json'. Go BodyParser strict typing: field declared string tapi input number → decode fail. Cegah type-juggling attack.",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("POST", accessToken, "/api/v1/sites", {
      body: JSON.stringify({ name: 123, theme: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/invalid json/i);
    act(testInfo, `HTTP ${res.status}, message="${body.error.message}"`);
  });

  test("POST /sites dengan theme = string — dokumentasi behavior (schema-less JSON)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "POST /api/v1/sites body={name:'test', theme:'not-object'} → dokumentasi. Backend field theme=json.RawMessage (no schema enforcement) → accept apa saja. FINDING: schema drift risk kalau renderer expect object. Ideal: validate theme.shape (colors, font, radius).",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("POST", accessToken, "/api/v1/sites", {
      body: JSON.stringify({ name: `theme-str-${Date.now()}`, theme: "should-be-object" }),
    });
    // Bukan 500 crash — either 400 (validation kick) atau 201 (schema-less accept).
    expect(res.status).not.toBe(500);
    let siteId = null;
    if (res.status === 201) {
      siteId = (await res.json()).data?.id;
    }
    const gap =
      res.status === 201
        ? "GAP: theme accept apa saja (schema-less) — potential renderer crash"
        : `reject with HTTP ${res.status}`;
    act(testInfo, `HTTP ${res.status} — ${gap}`);
    if (siteId) {
      await api("DELETE", accessToken, `/api/v1/sites/${siteId}`).catch(() => {});
    }
  });
});

test.describe("Negative — Path parameter validation", () => {
  test("GET /sites/not-a-uuid → 400 'invalid id'", async ({ context }, testInfo) => {
    req(
      testInfo,
      "GET /api/v1/sites/not-a-uuid → HTTP 400 error.code='bad_request' message='invalid id'. Backend uuid.Parse fail-safe: kalau path bukan valid UUID format → 400 sebelum DB query. Cegah wasted SQL + potential injection point.",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await api("GET", accessToken, "/api/v1/sites/not-a-uuid-here");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/invalid id/i);
    act(
      testInfo,
      `HTTP ${res.status}, message="${body.error.message}"`,
    );
  });

  test("GET /pages/12345 (numeric bukan UUID) → 400", async ({ context }, testInfo) => {
    req(
      testInfo,
      "GET /api/v1/pages/12345 → HTTP 400. Numeric ID = legacy pattern; backend pakai UUID exclusively, jadi reject sebelum DB.",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await api("GET", accessToken, "/api/v1/pages/12345");
    expect(res.status).toBe(400);
    act(testInfo, `HTTP ${res.status} — numeric ID sebagai UUID ditolak`);
  });

  test("GET /sites/../etc/passwd → 400/404 (path traversal blocked)", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "GET /api/v1/sites/..%2Fetc%2Fpasswd → HTTP 400/404. Path traversal segment tidak match UUID pattern. Router harus normalize sebelum handler.",
    );
    const { accessToken } = await loginAs(context, "client");
    const evil = encodeURIComponent("../etc/passwd");
    const res = await api("GET", accessToken, `/api/v1/sites/${evil}`);
    expect([400, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
    act(testInfo, `HTTP ${res.status} — path traversal via param ditolak`);
  });
});

test.describe("Negative — Query parameter boundary", () => {
  test("GET /admin/users?page=abc (non-numeric) → 200 fallback default page=1", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "GET /admin/users?page=abc → HTTP 200 dengan response.page=1 (backend strconv.Atoi silent fallback ke default). Bukan 400 karena forgiving parse. Verify: response.page adalah nomor sane (bukan 'abc' echoed).",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("GET", accessToken, "/api/v1/admin/users?page=abc");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(typeof data.page).toBe("number");
    expect(data.page).toBeGreaterThanOrEqual(1);
    act(
      testInfo,
      `HTTP 200, page (parsed)=${data.page} — non-numeric fallback ke default`,
    );
  });

  test("GET /admin/audit-log?since=invalid-date → 400 'harus RFC3339'", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "GET /admin/audit-log?since=not-a-date → HTTP 400 error.message match 'RFC3339'. Date parsing strict (bukan silent fallback), karena filter salah = wrong data displayed = bug UX.",
    );
    const { accessToken } = await loginAs(context, "admin");
    const res = await api("GET", accessToken, "/api/v1/admin/audit-log?since=not-a-date");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.message).toMatch(/RFC3339|3339|date/i);
    act(testInfo, `HTTP ${res.status}, message="${body.error.message}"`);
  });
});

test.describe("Negative — HTTP method restrictions", () => {
  test("PUT /api/v1/sites (method not allowed) → 404 atau 405", async ({
    context,
  }, testInfo) => {
    req(
      testInfo,
      "PUT /api/v1/sites (endpoint expect POST) → HTTP 404 atau 405. Fiber router strict-per-method, PUT ke POST endpoint tidak match route → 404. Kalau 200 = router accept semua method (security anti-pattern).",
    );
    const { accessToken } = await loginAs(context, "client");
    const res = await fetch(`${apiBase}/api/v1/sites`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "test" }),
    });
    expect([404, 405]).toContain(res.status);
    expect(res.status).not.toBe(200);
    act(testInfo, `HTTP ${res.status} — PUT ke POST endpoint ditolak`);
  });

  test("DELETE /api/v1/healthz → 404/405 (endpoint hanya GET)", async ({}, testInfo) => {
    req(
      testInfo,
      "DELETE /healthz → HTTP 404/405. Public endpoint /healthz hanya GET; method lain harus reject.",
    );
    const res = await fetch(`${apiBase}/healthz`, { method: "DELETE" });
    expect([404, 405]).toContain(res.status);
    act(testInfo, `HTTP ${res.status} — DELETE ke /healthz ditolak`);
  });
});

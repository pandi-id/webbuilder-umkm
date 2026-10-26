// auth.mjs — helper login per role.
//
// Strategy: pakai localStorage token approach yang match dengan
// /Users/pandi-rofai/Project/web-builder/website/apps/web/lib/api.ts:
//   - Token disimpan di localStorage key `wb_access_token` + `wb_refresh_token`
//   - Login via POST /api/v1/auth/login → response { access_token, refresh_token }
//
// Kalau localStorage approach gagal (mis. session iframe policy),
// fallback ke UI login form fill.

import { config } from "./config.mjs";

/**
 * Login via API + inject token ke localStorage.
 * Lebih cepat + robust dari UI login (no form field selector).
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} role — 'client' | 'agent' | 'reseller' | 'admin'
 */
export async function loginViaToken(context, role) {
  const account = config.accounts[role];
  if (!account) {
    throw new Error(`Unknown role: ${role}`);
  }

  console.log(`  → Login ${role} (${account.email})...`);

  // Call login API directly via fetch dari Node context.
  // Kita perlu domain-scoped API URL. Kalau baseUrl frontend, biasanya API
  // di subdomain terpisah (api.kubaca.id). Auto-derive.
  const apiBase = deriveApiBase(config.baseUrl);
  const loginUrl = `${apiBase}/api/v1/auth/login`;

  const res = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Login ${role} failed (${res.status}): ${errText.slice(0, 200)}`,
    );
  }

  const body = await res.json();
  const data = body.data || body;
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;

  if (!accessToken) {
    throw new Error(`Login response tidak punya access_token: ${JSON.stringify(body).slice(0, 200)}`);
  }

  // Inject token ke localStorage via context init script.
  // Wajib set SEBELUM navigate — kalau tidak, api client cek `getAccessToken()`
  // return null → redirect ke /login.
  await context.addInitScript(({ access, refresh }) => {
    try {
      localStorage.setItem("wb_access_token", access);
      if (refresh) localStorage.setItem("wb_refresh_token", refresh);
    } catch (e) {
      console.error("localStorage set failed", e);
    }
  }, { access: accessToken, refresh: refreshToken });

  return { accessToken, refreshToken, apiBase };
}

/**
 * Fallback: login via UI form (kalau API login gagal — mis. CORS strict).
 *
 * @param {import('playwright').Page} page
 * @param {string} role
 */
export async function loginViaUI(page, role) {
  const account = config.accounts[role];
  console.log(`  → Login ${role} via UI form...`);

  await page.goto(`${config.baseUrl}/login`);
  await page.waitForLoadState("networkidle");

  // Fill form — pakai selector generic biar tahan perubahan minor
  await page.locator('input[type="email"], input[name="email"]').fill(account.email);
  await page.locator('input[type="password"], input[name="password"]').fill(account.password);

  // Submit
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Masuk")').first().click();

  // Wait redirect ke dashboard sesuai role
  const dashboardPath = {
    admin: /\/admin/,
    reseller: /\/reseller/,
    agent: /\/agent/,
    client: /\/dashboard/,
  }[role];

  await page.waitForURL(dashboardPath, { timeout: 10000 });
  console.log(`  ✓ Logged in as ${role}`);
}

/**
 * Derive API base URL dari frontend base URL.
 * Heuristic:
 *   https://kubaca.id → https://api.kubaca.id
 *   http://localhost:3000 → http://localhost:8080 (default HTTP_ADDR API)
 */
function deriveApiBase(baseUrl) {
  // Kalau env explicit set, gunakan itu
  if (process.env.API_BASE) return process.env.API_BASE;

  try {
    const url = new URL(baseUrl);
    // Localhost: swap port ke 8080 (default API)
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return `${url.protocol}//${url.hostname}:8080`;
    }
    // Production: prepend "api." ke hostname
    // Handle: kubaca.id → api.kubaca.id
    return `${url.protocol}//api.${url.hostname}`;
  } catch (e) {
    console.warn("Failed to derive API base, using baseUrl", e.message);
    return baseUrl;
  }
}

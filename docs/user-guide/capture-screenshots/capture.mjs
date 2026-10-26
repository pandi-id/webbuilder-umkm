// capture.mjs — main script auto-capture screenshot semua page per role.
//
// Usage:
//   node capture.mjs                # capture all roles
//   node capture.mjs client         # capture cuma role client
//   node capture.mjs admin reseller # capture 2 role
//   HEADED=1 node capture.mjs       # show browser window (debugging)
//   VERBOSE=1 node capture.mjs      # print detailed logs
//
// Environment:
//   BASE_URL          — frontend URL (default http://localhost:3000)
//   API_BASE          — API URL (auto-derived kalau kosong)
//   {ROLE}_EMAIL      — override email per role
//   {ROLE}_PASSWORD   — override password per role
//   SAMPLE_SITE_ID    — pakai site ID spesifik (bukan auto-pick)
//   SAMPLE_DOMAIN     — pakai domain spesifik
//   SAMPLE_CLIENT_ID  — pakai client ID spesifik untuk OBO flow

import { chromium } from "playwright";
import { mkdir, writeFile, access } from "fs/promises";
import { existsSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import { config, captures } from "./config.mjs";
import { loginViaToken, loginViaUI } from "./auth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, config.outputDir);

const VERBOSE = process.env.VERBOSE === "1";
const HEADED = process.env.HEADED === "1";

// ---------- Main ----------
async function main() {
  const args = process.argv.slice(2);
  const rolesToCapture = args.length > 0 ? args : ["client", "agent", "reseller", "admin"];

  // Validate roles
  for (const role of rolesToCapture) {
    if (!captures[role]) {
      console.error(`❌ Unknown role: ${role}. Valid: client, agent, reseller, admin`);
      process.exit(1);
    }
  }

  // Ensure output folder exists
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`\n📸 Web Builder Screenshot Capture`);
  console.log(`   Base URL: ${config.baseUrl}`);
  console.log(`   Output:   ${OUTPUT_DIR}`);
  console.log(`   Roles:    ${rolesToCapture.join(", ")}`);
  console.log(`   Viewport: ${config.viewport.width}×${config.viewport.height}`);
  console.log(`   Headless: ${!HEADED}\n`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const stats = { success: 0, failed: 0, skipped: 0 };

  try {
    for (const role of rolesToCapture) {
      console.log(`\n━━━━ Role: ${role.toUpperCase()} ━━━━`);
      await captureRole(browser, role, stats);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n━━━━ Summary ━━━━`);
  console.log(`  ✓ Success: ${stats.success}`);
  console.log(`  ✗ Failed:  ${stats.failed}`);
  console.log(`  − Skipped: ${stats.skipped}`);
  console.log(`\n  Output: ${OUTPUT_DIR}\n`);
}

async function captureRole(browser, role, stats) {
  const context = await browser.newContext({
    viewport: config.viewport,
    // Ignore HTTPS errors untuk staging dengan self-signed cert
    ignoreHTTPSErrors: true,
    // Locale ID untuk copy Indonesia
    locale: "id-ID",
  });

  // Login sebelum navigate ke page.
  try {
    await loginViaToken(context, role);
  } catch (e) {
    console.error(`  ✗ Token login failed: ${e.message}`);
    console.log(`  → Fallback ke UI login...`);
    const page = await context.newPage();
    try {
      await loginViaUI(page, role);
    } catch (e2) {
      console.error(`  ✗ UI login juga gagal: ${e2.message}`);
      console.error(`     Skip semua capture role ${role}`);
      stats.skipped += captures[role].length;
      await context.close();
      return;
    } finally {
      await page.close();
    }
  }

  // Resolve sample IDs — kalau ada di config, pakai. Kalau tidak, auto-discover.
  const ids = await resolveSampleIds(context, role);
  if (VERBOSE) console.log(`  Sample IDs: ${JSON.stringify(ids)}`);

  // Capture setiap page
  for (const entry of captures[role]) {
    await capturePage(context, entry, ids, stats);
  }

  await context.close();
}

async function resolveSampleIds(context, role) {
  const ids = { ...config.sampleIds };

  // Kalau semua ada di config, skip auto-discover
  if (ids.siteId && ids.domain && ids.clientId) return ids;

  const page = await context.newPage();
  try {
    // Auto-discover siteId dari list sites
    if (!ids.siteId) {
      try {
        await page.goto(`${config.baseUrl}/dashboard`, { waitUntil: "networkidle", timeout: 10000 });
        // Cari link ke /sites/[uuid]
        const link = page.locator('a[href*="/sites/"][href*="-"]').first();
        if (await link.count() > 0) {
          const href = await link.getAttribute("href");
          const match = href?.match(/\/sites\/([0-9a-f-]{36})/);
          if (match) ids.siteId = match[1];
        }
      } catch (e) {
        if (VERBOSE) console.log(`    (siteId discover skipped: ${e.message.slice(0, 60)})`);
      }
    }

    // Auto-discover domain
    if (!ids.domain) {
      try {
        await page.goto(`${config.baseUrl}/settings/domains`, { waitUntil: "networkidle", timeout: 10000 });
        // Cari link ke /settings/domains/[domain]
        const link = page.locator('a[href*="/settings/domains/"]').first();
        if (await link.count() > 0) {
          const href = await link.getAttribute("href");
          const match = href?.match(/\/settings\/domains\/([^\/\?]+)/);
          if (match) ids.domain = decodeURIComponent(match[1]);
        }
      } catch (e) {
        if (VERBOSE) console.log(`    (domain discover skipped: ${e.message.slice(0, 60)})`);
      }
    }

    // Auto-discover clientId (untuk agent/reseller)
    if (!ids.clientId && (role === "agent" || role === "reseller")) {
      try {
        const clientsUrl = role === "agent" ? "/agent/clients" : "/reseller/clients";
        await page.goto(`${config.baseUrl}${clientsUrl}`, { waitUntil: "networkidle", timeout: 10000 });
        const link = page.locator('a[href*="/clients/"][href*="-"]').first();
        if (await link.count() > 0) {
          const href = await link.getAttribute("href");
          const match = href?.match(/\/clients\/([0-9a-f-]{36})/);
          if (match) ids.clientId = match[1];
        }
      } catch (e) {
        if (VERBOSE) console.log(`    (clientId discover skipped: ${e.message.slice(0, 60)})`);
      }
    }
  } finally {
    await page.close();
  }

  return ids;
}

async function capturePage(context, entry, ids, stats) {
  const name = entry.name;
  const outputPath = join(OUTPUT_DIR, `${name}.png`);

  // Check required IDs
  if (entry.requiresSiteId && !ids.siteId) {
    console.log(`  − ${name}: skip (butuh siteId, tidak ada)`);
    stats.skipped++;
    return;
  }
  if (entry.requiresDomain && !ids.domain) {
    console.log(`  − ${name}: skip (butuh domain, tidak ada)`);
    stats.skipped++;
    return;
  }
  if (entry.requiresClientId && !ids.clientId) {
    console.log(`  − ${name}: skip (butuh clientId, tidak ada)`);
    stats.skipped++;
    return;
  }

  // Resolve path
  const path = typeof entry.path === "function" ? entry.path(ids) : entry.path;
  const url = `${config.baseUrl}${path}`;

  const page = await context.newPage();
  try {
    if (VERBOSE) console.log(`  → ${name}: navigating to ${url}`);

    // Navigate
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    // Wait for selector kalau di-specified
    if (entry.waitFor) {
      try {
        await page.waitForSelector(entry.waitFor, { timeout: 5000 });
      } catch (e) {
        // Fallback: cukup wait networkidle
        if (VERBOSE) console.log(`    (waitFor selector timeout, lanjut screenshot)`);
      }
    }

    // Delay standard
    await page.waitForTimeout(config.delays.afterNavigate);

    // Custom action (mis. click button untuk buka dialog)
    if (entry.action) {
      try {
        await entry.action(page);
      } catch (e) {
        console.log(`    (action failed: ${e.message.slice(0, 80)})`);
      }
      await page.waitForTimeout(config.delays.afterClick);
    }

    // Extra delay sebelum screenshot (untuk animation settle)
    if (entry.preScreenshotDelay) {
      await page.waitForTimeout(entry.preScreenshotDelay);
    } else {
      await page.waitForTimeout(config.delays.beforeScreenshot);
    }

    // Screenshot
    await page.screenshot({
      path: outputPath,
      type: config.screenshot.type,
      fullPage: entry.fullPage ?? config.screenshot.fullPage,
      omitBackground: config.screenshot.omitBackground,
    });

    console.log(`  ✓ ${name}.png`);
    stats.success++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message.slice(0, 120)}`);
    stats.failed++;

    // Save debug screenshot pada error (kalau bukan navigation error)
    if (!e.message.includes("net::") && !e.message.includes("Timeout")) {
      try {
        await page.screenshot({ path: `${outputPath}.error.png` });
        console.log(`    (debug screenshot saved: ${name}.png.error.png)`);
      } catch { /* ignore */ }
    }
  } finally {
    await page.close();
  }
}

// ---------- Run ----------
main().catch((e) => {
  console.error("\n❌ Fatal error:", e);
  process.exit(1);
});

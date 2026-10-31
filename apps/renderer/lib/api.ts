import { headers } from "next/headers";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8080";

// currentHost — baca Host header dari request context (Next.js server
// component). Dipakai fetchJson untuk forward ke API sebagai
// `X-Renderer-Host` — API middleware `HostSiteGuard` verify site.id di
// URL match dengan host ini (defense in depth cross-tenant leak).
//
// Kenapa via headers() (bukan pass eksplisit): supaya semua caller api.ts
// otomatis dapat guard tanpa refactor tiap fungsi. `headers()` per-request
// scoped di App Router — aman multi-tenant.
//
// Return "" kalau tidak dipanggil dari server component (mis. static
// generation di build time) — API skip guard kalau header kosong.
async function currentHost(): Promise<string> {
  try {
    const h = (await headers()).get("host") ?? "";
    // Strip port + lowercase.
    return h.toLowerCase().split(":")[0];
  } catch {
    // headers() throws di context yang bukan request (build-time RSC).
    return "";
  }
}

export type Site = {
  id: string;
  slug: string;
  name: string;
  status: string;
  theme: ThemeJson | null;
  // Shared header/footer per site — renderer prepend header + append footer
  // ke setiap page saat render. `{}` = no layout, page render apa adanya.
  layout?: SiteLayout | null;
  // Raw HTML/JS user, di-inject persis di </head> dan </body>. Renderer
  // MEMBACA field ini via dangerouslySetInnerHTML — sengaja tidak sanitize
  // karena kasus penggunaan (GTM, Meta Pixel) butuh raw script tags.
  custom_head_code?: string;
  custom_body_end_code?: string;
};

export type SiteLayout = {
  header?: Block[];
  footer?: Block[];
  // Enabled flags — kalau false, renderer skip prepend header / append footer
  // walaupun blocks-nya ada. Default true untuk backward compat (site lama
  // yang tidak punya field ini tetap render shared layout).
  header_enabled?: boolean;
  footer_enabled?: boolean;
};

export type ThemeJson = {
  colors?: { primary?: string; secondary?: string; bg?: string; fg?: string };
  font?: { heading?: string; body?: string };
  radius?: string;
};

export type Page = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  tree: { blocks?: Block[] } | null;
  seo: {
    title?: string;
    description?: string;
    ogImage?: string;
    canonical?: string;
    noindex?: boolean;
  } | null;
  is_home: boolean;
};

export type Block = {
  type: string;
  props?: Record<string, unknown>;
  // Nested children — populated only for container-style blocks (Container,
  // Columns). The renderer recursively walks this when present.
  children?: Block[];
  // Per-block wrapper metadata (padding/margin/maxWidth/align/bg + colour
  // override). All optional — set in the editor's Layout & Style panel.
  layout?: {
    pt?: number; pr?: number; pb?: number; pl?: number;
    mt?: number; mb?: number;
    maxWidth?: "full" | "narrow" | "prose" | "wide";
    align?: "left" | "center" | "right";
    bg?: string;
    hidden?: { mobile?: boolean; tablet?: boolean; desktop?: boolean };
    responsive?: {
      tablet?: ResponsivePatch;
      desktop?: ResponsivePatch;
    };
  };
  themeOverride?: { primary?: string; secondary?: string; bg?: string; fg?: string };
};

type ResponsivePatch = {
  pt?: number; pr?: number; pb?: number; pl?: number;
  mt?: number; mb?: number;
  maxWidth?: "full" | "narrow" | "prose" | "wide";
  align?: "left" | "center" | "right";
  bg?: string;
};

// FetchError — status 0 = network/timeout failure (bukan dari HTTP response).
// Status 5xx = backend reachable tapi error. Code = business error code.
export class FetchError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    public path: string,
  ) {
    super(`fetch ${path} → ${status}${code ? ` [${code}]` : ""}`);
    this.name = "FetchError";
  }
}

// FETCH_TIMEOUT_MS — hard cap per attempt. Backend normal respond <500ms;
// kalau >8s pasti ada yang stuck (slow query, lock contention, EPP hang).
// Lebih baik timeout + retry daripada hang indefinitely bikin Next.js
// render stuck 30+ detik lalu user refresh paksa.
const FETCH_TIMEOUT_MS = 8_000;

// FETCH_MAX_ATTEMPTS — initial + N retry. Hanya retry untuk failure yang
// transient (5xx, network, timeout). 404 TIDAK di-retry (semantic jelas:
// resource memang tidak ada).
const FETCH_MAX_ATTEMPTS = 3;

// fetchJson — helper untuk /public/* endpoints.
//
// `revalidateSec`:
//   - `0` (atau negatif) → `cache: "no-store"` — SETIAP call hit backend.
//     Dipakai untuk lookup kritikal (site/page) supaya tidak ada ghost 404
//     dari Next.js data cache. User reload tetap trigger request asli.
//   - `>0` → `next: { revalidate: N }` — Next.js cache response (termasuk
//     4xx!) selama N detik. HANYA pakai untuk data yang tidak critical
//     untuk 404-correctness (products, blog, dsb.) karena kalau backend
//     sempat 404, cache akan serve 404 instan selama N detik walau
//     backend sudah pulih.
//
// Perilaku non-trivial:
//   1. Retry dengan backoff untuk 5xx + network + timeout — supaya transient
//      backend blip tidak bikin user lihat 404 palsu.
//   2. 4xx TIDAK di-retry — resource memang tidak ada, retry buang waktu.
//   3. Caller yang pakai .ok=false TIDAK tahu beda 404 vs 500. Yang perlu
//      distinguish gunakan `fetchJsonOrThrow` (throw FetchError untuk non-404)
//      supaya Next.js error.tsx muncul (bukan page 404 palsu).
// DEBUG — kalau RENDERER_FETCH_DEBUG=true, log tiap backend call ke stderr.
// Dipakai saat verifikasi "apakah backend benar-benar di-hit". Buka container
// renderer: `docker logs -f <renderer>` → saat refresh page akan muncul
// `[fetch] GET /public/...` dengan status + ms.
const FETCH_DEBUG = process.env.RENDERER_FETCH_DEBUG === "true";

async function fetchJson<T>(
  path: string,
  revalidateSec = 5,
): Promise<{ ok: true; data: T } | { ok: false; status: number; code?: string }> {
  const host = await currentHost();
  const noCache = revalidateSec <= 0;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const started = Date.now();
    try {
      const init: RequestInit & { next?: { revalidate?: number } } = {
        signal: controller.signal,
      };
      if (noCache) {
        init.cache = "no-store";
      } else {
        init.next = { revalidate: revalidateSec };
      }
      if (host) {
        init.headers = { "X-Renderer-Host": host };
      }
      const res = await fetch(`${API}${path}`, init);
      clearTimeout(timer);
      const elapsed = Date.now() - started;

      // DEBUG log — selalu untuk 5xx/404, opt-in via env untuk 2xx.
      if (FETCH_DEBUG || res.status >= 400) {
        // eslint-disable-next-line no-console
        console.log(
          `[fetch] ${res.status} GET ${path} ${elapsed}ms attempt=${attempt} cache=${noCache ? "no-store" : `rev${revalidateSec}`} host=${host}`,
        );
      }

      if (res.ok) {
        const body = await res.json();
        return { ok: true, data: body.data as T };
      }

      // 4xx — client error, resource genuinely tidak ada. Baca body untuk
      // business code, return tanpa retry.
      if (res.status >= 400 && res.status < 500) {
        let code: string | undefined;
        try {
          const err = await res.json();
          if (err?.error?.code) code = String(err.error.code);
        } catch {}
        return { ok: false, status: res.status, code };
      }

      // 5xx — transient, retry dengan backoff.
      lastErr = new FetchError(res.status, undefined, path);
    } catch (e) {
      clearTimeout(timer);
      const elapsed = Date.now() - started;
      // eslint-disable-next-line no-console
      console.log(
        `[fetch] ERR GET ${path} ${elapsed}ms attempt=${attempt} err=${(e as Error).message}`,
      );
      // AbortError / TypeError (network) — treat as transient.
      lastErr = e;
    }

    // Backoff: 150ms, 450ms. Total max wait: 600ms + 3 × 8s timeout = 24.6s
    // worst-case tapi normally sukses di attempt 1 atau 2.
    if (attempt < FETCH_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 150 * attempt * attempt));
    }
  }

  // All retries habis — return error so caller bisa decide. Caller yang
  // sensitive (page/site lookup) sebaiknya pakai fetchJsonOrThrow.
  if (lastErr instanceof FetchError) {
    return { ok: false, status: lastErr.status };
  }
  // Network / timeout / abort — status 0 sentinel.
  return { ok: false, status: 0 };
}

// fetchJsonOrThrow — wrapper yang throw untuk failure non-404.
//
// Kenapa penting: `page.tsx` punya pattern `if (!page) notFound()`. Kalau
// backend 5xx atau network error, treat as null = user lihat 404 palsu.
// Dengan throw, Next.js error.tsx muncul (menampilkan 500 asli) — lebih
// jujur ke user + tim ops bisa trace via Sentry/log.
//
// 404 tetap return null (benar-benar not found) — caller lanjut notFound()
// atau fallback.
async function fetchJsonOrThrow<T>(path: string, revalidateSec = 5): Promise<T | null> {
  const r = await fetchJson<T>(path, revalidateSec);
  if (r.ok) return r.data;
  // 404 = genuine not found. Null.
  if (r.status === 404) return null;
  // Error lain (5xx, 0 = network/timeout) = throw. Next.js error.tsx handle.
  throw new FetchError(r.status, r.code, path);
}

// SiteLookup — hasil resolve host, dengan reason kalau site tidak return.
// `reason` = "site_not_published" berarti site ada tapi status draft;
// `reason` = "no_site_for_host" berarti host tidak ter-attach ke site mana pun.
export type SiteLookup =
  | { kind: "found"; site: Site }
  | { kind: "not_found"; reason: "site_not_published" | "no_site_for_host" | "unknown" };

export async function lookupSiteByHost(host: string): Promise<SiteLookup> {
  // revalidateSec=0 → cache:"no-store". Site lookup wajib hit backend tiap
  // request supaya publish/unpublish langsung visible + tidak ada ghost 404
  // yang di-cache Next.js data layer.
  const r = await fetchJson<Site>(
    `/public/site-by-host?host=${encodeURIComponent(host)}`,
    0,
  );
  if (r.ok) return { kind: "found", site: r.data };
  // 5xx / network / timeout → throw ke error boundary. Jangan treat sebagai
  // "domain belum terhubung" (misleading — backend yang nganggur, bukan
  // domain-nya yang salah).
  if (r.status >= 500 || r.status === 0) {
    throw new FetchError(r.status, r.code, `/public/site-by-host?host=${host}`);
  }
  const reason =
    r.code === "site_not_published"
      ? "site_not_published"
      : r.code === "no_site_for_host"
      ? "no_site_for_host"
      : "unknown";
  return { kind: "not_found", reason };
}

// Backward-compat helper — caller yang cuma butuh Site atau null.
export async function getSiteByHost(host: string): Promise<Site | null> {
  const r = await lookupSiteByHost(host);
  return r.kind === "found" ? r.site : null;
}

// getPage — no cache (revalidateSec=0 → cache:"no-store"). Setiap request
// hit backend. Sebelumnya pakai revalidate=1, tapi Next.js tetap cache 404
// selama 1 detik — user yang buka langsung setelah publish lihat 404 "palsu"
// yang instan (seperti tidak ada backend call). Sekarang setiap render SSR
// pasti tanya backend dulu.
//
// Pakai fetchJsonOrThrow — kalau backend 5xx / timeout / network, THROW
// bukan return null. Supaya `page.tsx` tidak mis-render 404 untuk kegagalan
// backend transient.
export async function getPage(siteId: string, slug: string): Promise<Page | null> {
  return fetchJsonOrThrow<Page>(
    `/public/sites/${siteId}/pages/${encodeURIComponent(slug)}`,
    0,
  );
}

export async function listPages(siteId: string): Promise<Page[]> {
  const r = await fetchJson<Page[]>(`/public/sites/${siteId}/pages`, 1);
  return r.ok ? r.data : [];
}

// getPagePreview fetches the DRAFT tree of a page via a signed HMAC token,
// bundled with its owning site (for theme + font). Cache disabled so the
// reviewer always sees the freshest draft.
export async function getPagePreview(
  token: string,
): Promise<{ page: Page; site: Site } | null> {
  const res = await fetch(`${API}/public/preview/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.data as { page: Page; site: Site };
}

// --- Products + Blog (public read) ---

export type Product = {
  id: string;
  site_id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number | null;
  image_url: string;
  gallery: string[] | null;
  category: string;
  status: string;
};

export type BlogPost = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  excerpt: string;
  content_md: string;
  cover_image_url: string;
  author_name: string;
  tags: string[] | null;
  status: string;
  published_at: string | null;
};

export async function listProducts(siteId: string, limit = 20): Promise<Product[]> {
  const r = await fetchJson<Product[]>(`/public/sites/${siteId}/products?limit=${limit}`);
  return r.ok ? r.data : [];
}

export async function getProduct(siteId: string, slug: string): Promise<Product | null> {
  // revalidateSec=0 → no Next.js data cache (cegah ghost 404 saat race publish).
  return fetchJsonOrThrow<Product>(
    `/public/sites/${siteId}/products/${encodeURIComponent(slug)}`,
    0,
  );
}

export type ProductReview = {
  id: string;
  rating: number;
  author_name: string;
  body: string;
  verified_buyer: boolean;
  reply: string;
  replied_at: string | null;
  created_at: string;
};

// breakdown[0] = number of 1-star reviews … breakdown[4] = 5-star. Computed
// over every published review, so it matches `count` even when the item list
// is capped by `limit`.
export type ReviewSummary = { average: number; count: number; breakdown: number[] };

export async function getProductReviews(
  siteId: string,
  slug: string,
  limit = 20,
): Promise<{ items: ProductReview[]; summary: ReviewSummary }> {
  const r = await fetchJson<{ items: ProductReview[]; summary: ReviewSummary }>(
    `/public/sites/${siteId}/products/${encodeURIComponent(slug)}/reviews?limit=${limit}`,
  );
  // Reviews are decoration around the product: a failure here must never take
  // the product page down with it.
  return r.ok ? r.data : { items: [], summary: { average: 0, count: 0, breakdown: [0, 0, 0, 0, 0] } };
}

// One call for the whole catalog, keyed by product slug — a grid of cards must
// not fan out to one request per card.
export async function getReviewSummaries(siteId: string): Promise<Record<string, ReviewSummary>> {
  const r = await fetchJson<Record<string, ReviewSummary>>(
    `/public/sites/${siteId}/review-summary`,
  );
  return r.ok ? r.data : {};
}

export async function listBlogPosts(siteId: string, limit = 20): Promise<BlogPost[]> {
  const r = await fetchJson<BlogPost[]>(`/public/sites/${siteId}/blog-posts?limit=${limit}`);
  return r.ok ? r.data : [];
}

export async function getBlogPost(siteId: string, slug: string): Promise<BlogPost | null> {
  // revalidateSec=0 → no cache. Owner sering publish lalu verify langsung;
  // cache 1 detik tetap kemungkinan serve 404 "palsu" instant kalau race.
  return fetchJsonOrThrow<BlogPost>(
    `/public/sites/${siteId}/blog-posts/${encodeURIComponent(slug)}`,
    0,
  );
}

// --- Forms (public read for renderer) ---

export type FormField = {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "url";
  required?: boolean;
  placeholder?: string;
};

export type PublicForm = {
  id: string;
  site_id: string;
  name: string;
  kind: string;
  fields: FormField[] | null;
};

// Fetch definisi form (fields, kind, name) untuk render di renderer. Endpoint
// public — TIDAK expose notify_email. UUID validation dilakukan di backend, kita
// pass-through saja (invalid → 400 → return null).
export async function getPublicForm(id: string): Promise<PublicForm | null> {
  if (!id) return null;
  const r = await fetchJson<PublicForm>(`/public/forms/${encodeURIComponent(id)}`);
  return r.ok ? r.data : null;
}

// formatPrice — IDR aware, smallest-unit input (15000 → "Rp 15.000")
export function formatPrice(price: number, currency: string): string {
  if (currency === "IDR") return `Rp ${price.toLocaleString("id-ID")}`;
  return `${currency} ${price.toLocaleString("id-ID")}`;
}

// -------- Template live preview (plan-admin-templates.md Phase 2) --------

export type TemplatePreviewPage = {
  slug: string;
  title: string;
  is_home: boolean;
  tree: { blocks?: Block[] } | null;
  seo: {
    title?: string;
    description?: string;
    ogImage?: string;
    canonical?: string;
    noindex?: boolean;
  } | null;
};

export type TemplatePreview = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  variant: string;
  theme: ThemeJson | null;
  pages: TemplatePreviewPage[];
};

// getTemplatePreview — fetch template lengkap dengan semua pages + theme,
// dipakai renderer route `/template-preview/:slug` untuk render HTML live.
// Kalau template belum published atau slug tidak ada → null (renderer 404).
export async function getTemplatePreview(slug: string): Promise<TemplatePreview | null> {
  if (!slug) return null;
  const r = await fetchJson<TemplatePreview>(
    `/public/template-preview/${encodeURIComponent(slug)}`,
  );
  return r.ok ? r.data : null;
}

// getTemplatePreviewByID — sama seperti getTemplatePreview tapi accept UUID
// dan return template regardless of status (draft/archived/published).
// Dipakai admin dashboard untuk live preview template saat editing.
// Bypass cache (revalidate 0) karena admin edit-preview cycle butuh fresh.
export async function getTemplatePreviewByID(
  id: string,
): Promise<TemplatePreview | null> {
  if (!id) return null;
  const r = await fetchJson<TemplatePreview>(
    `/public/template-preview-by-id/${encodeURIComponent(id)}`,
    0, // bypass cache — admin preview harus reflect state DB terbaru
  );
  return r.ok ? r.data : null;
}

// findTemplatePage — helper untuk cari page berdasarkan slug (atau home page
// kalau slug kosong). Return null kalau tidak ketemu.
export function findTemplatePage(
  tpl: TemplatePreview,
  pageSlug: string,
): TemplatePreviewPage | null {
  if (!pageSlug || pageSlug === "_home") {
    return tpl.pages.find((p) => p.is_home) ?? tpl.pages[0] ?? null;
  }
  return tpl.pages.find((p) => p.slug === pageSlug) ?? null;
}

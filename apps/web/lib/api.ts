const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://api.localhost";

export type ApiResult<T> = { data: T } | { error: { code: string; message: string } };

// ApiError menambah `status` + `code` di atas Error biasa. Callers boleh
// tetap pakai `(e as Error).message` — subclass ini fully backward compat.
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function tokenKey() {
  return "wb_access_token";
}
function refreshKey() {
  return "wb_refresh_token";
}

export function setTokens(access: string, refresh: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(tokenKey(), access);
  localStorage.setItem(refreshKey(), refresh);
}
export function clearTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(tokenKey());
  localStorage.removeItem(refreshKey());
}
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(tokenKey());
}

// errMessage — defensive error → string extractor untuk catch blocks.
// Hindari pattern `(e as Error).message` yang throw lagi kalau e === null
// (common saat fetch abort / promise reject tanpa body) → Next.js 14
// unhandled rejection handler panic dengan "Cannot read properties of null
// (reading 'digest')".
//
// Pakai di semua catch block UI: `catch (e) { setErr(errMessage(e)); }`.
export function errMessage(e: unknown, fallback = "unknown error"): string {
  if (e instanceof Error) return e.message || fallback;
  if (e == null) return fallback;
  if (typeof e === "string") return e;
  try {
    return String(e);
  } catch {
    return fallback;
  }
}

// Paths yang tidak boleh trigger auto-redirect ke /login (mencegah loop).
// Semua route auth-related (login/register/verify/reset) di-skip.
const AUTH_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/daftar-reseller",
];

function isOnAuthPage(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return AUTH_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
}

// handleUnauthorized — dipanggil saat API return 401 (token invalid/expired).
// Clear tokens + redirect ke /login dengan ?next=<path saat ini> supaya user
// setelah login balik ke halaman yang dituju. Skip kalau:
//   - SSR (window undefined)
//   - Sudah di halaman auth (cegah redirect loop)
//   - Endpoint dipanggil dengan auth:false (public API, 401 bukan token issue)
function handleUnauthorized() {
  if (typeof window === "undefined") return;
  if (isOnAuthPage()) return;
  clearTokens();
  const current = window.location.pathname + window.location.search;
  const next = encodeURIComponent(current);
  // Pakai replace supaya user tidak bisa back ke halaman expired (bakal 401 lagi).
  window.location.replace(`/login?next=${next}`);
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  const useAuth = opts.auth !== false;
  if (useAuth) {
    const t = getAccessToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as ApiResult<T>;
  if (!res.ok || "error" in body) {
    const code = "error" in body ? body.error.code : "";
    const msg = "error" in body ? body.error.message : `HTTP ${res.status}`;
    // Global 401 handler — token invalid/expired. Skip untuk request public
    // (auth:false) karena 401 di sana bukan issue token user.
    if (res.status === 401 && useAuth) {
      handleUnauthorized();
    }
    throw new ApiError(res.status, code, msg);
  }
  return (body as { data: T }).data;
}

// PlatformArticle — blog / knowledge base platform-level, terpisah dari blog
// per-situs. Dipakai di homepage marketing + /artikel.
export type PlatformArticleCategory =
  | "umum" | "tutorial" | "cerita" | "tips" | "panduan" | "pengumuman";

export const PLATFORM_ARTICLE_CATEGORIES: Array<{ value: PlatformArticleCategory; label: string }> = [
  { value: "umum", label: "Umum" },
  { value: "tutorial", label: "Tutorial" },
  { value: "cerita", label: "Cerita" },
  { value: "tips", label: "Tips" },
  { value: "panduan", label: "Panduan" },
  { value: "pengumuman", label: "Pengumuman" },
];

export type PlatformArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_image_url: string;
  category: PlatformArticleCategory;
  author_name: string;
  tags: string[] | null;
  status: "draft" | "published";
  featured: boolean;
  reading_time_min: number;
  view_count: number;
  seo_title: string;
  seo_description: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

// openBlob — fetch endpoint yang return binary (PDF, image) dengan Bearer
// token, lalu buka blob URL di tab baru. Dipakai untuk tombol "Cetak PDF"
// yang tidak bisa pakai <a href> biasa karena butuh Authorization header.
export async function openBlob(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  const t = getAccessToken();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { headers, cache: "no-store" });
  if (!res.ok) {
    // Coba parse error envelope JSON — kalau PDF endpoint return error,
    // biasanya JSON envelope, bukan binary.
    let msg = `HTTP ${res.status}`;
    let code = "";
    try {
      const body = (await res.json()) as ApiResult<unknown>;
      if ("error" in body) {
        msg = body.error.message;
        code = body.error.code;
      }
    } catch {
      // ignore — body bukan JSON
    }
    throw new ApiError(res.status, code, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Revoke setelah 60 detik — browser sudah cache blob di tab baru.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

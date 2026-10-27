// Global proxy (eks-middleware) — jalankan per-request untuk SEMUA route renderer.
// Dua tugas:
//   1. Set `Vary: Host` → cegah downstream cache cross-tenant leak
//   2. Generate nonce + CSP header → fix WEBSEC03 (W3C CSP3) — tidak lagi
//      pakai 'unsafe-inline' / 'unsafe-eval' di script-src
//
// Multi-tenant note: CSP sama untuk semua tenant karena renderer serve
// konten pattern yang sama (user markdown + blocks). Kalau tenant
// butuh embed custom (mis. widget pihak ke-3), tambah ke script-src/frame-src.

import { NextResponse, type NextRequest } from "next/server";

const IS_PROD = process.env.NODE_ENV === "production";

// Browser-side API origin (FormBlock, PageViewBeacon, form blocks posting to
// the API). Derived from env so the CSP follows the deployment's API domain.
const API_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE ?? "").origin;
  } catch {
    return "";
  }
})();

export function proxy(req: NextRequest) {
  // Nonce — 16 bytes base64 ≈ 22 char, 128-bit entropy. Fresh per request.
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );

  // CSP tenant renderer — permisif untuk embed (YouTube, Spotify, Maps) karena
  // owner boleh pakai di konten. Tetap drop 'unsafe-inline'/'unsafe-eval' di
  // script-src → W3C CSP3 compliance.
  //
  // script-src pakai 'self' + nonce (bukan strict-dynamic) — tenant page
  // sering di-SSG/ISR, chunk script tag tanpa nonce. 'self' allow chunk
  // same-origin, nonce untuk inline RSC payload.
  //
  // frame-ancestors * : tenant site boleh di-iframe (editor preview + user
  // share link). Ini security trade-off khas platform multi-tenant site builder.
  const prodCsp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https:`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' ${API_ORIGIN} https:`.replace(/\s+/g, " "),
    `frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com`,
    `media-src 'self' blob: https:`,
    `frame-ancestors *`,
    `base-uri 'self'`,
    `form-action 'self' ${API_ORIGIN}`.trim(),
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const devCsp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' http://localhost:* ws://localhost:* https:`,
    `frame-src *`,
    `frame-ancestors *`,
  ].join("; ");

  const csp = IS_PROD ? prodCsp : devCsp;

  // CRITICAL: CSP header harus di-set di BOTH request + response headers.
  // - Request header → trigger Next.js server rendering auto-inject nonce
  //   ke <script> internal (bootstrap, RSC flight, hydration bootstrap).
  //   Tanpa ini: script internal tidak nonce'd → kena blok "inline script".
  // - Response header → enforce di browser.
  // Pattern dari Next.js official docs.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: reqHeaders } });

  // Vary: Host tidak di-set di sini. Next 16 selalu menimpa Vary dengan daftar
  // RSC-nya sendiri, jadi apa pun yang di-set dari proxy (atau next.config
  // headers) tidak pernah sampai ke klien. Cache isolation multi-tenant
  // ditegakkan di Caddy — lihat `header Vary Host` di infra/caddy/Caddyfile.bin.

  res.headers.set("Content-Security-Policy", csp);

  // Cache-Control: no-store, must-revalidate — cegah browser (atau CDN) cache
  // 404/200 page HTML. Alasan: user publish situs, lalu buka langsung — kalau
  // browser cache 404 1 menit (default heuristic), user kesal karena refresh
  // tetap 404. Static assets (css/js/image) tidak kena matcher ini, jadi tetap
  // bisa di-cache panjang via _next/static.
  //
  // Trade-off: setiap page request tidak reuse by browser; backend hit mandatory.
  // Diperbolehkan karena page HTML renderer SSR-ed dengan dynamic='force-dynamic'
  // di semua route — expectation per-request fresh.
  if (!res.headers.get("Cache-Control")) {
    res.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf)$).*)",
  ],
};

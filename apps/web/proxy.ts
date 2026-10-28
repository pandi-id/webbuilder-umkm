// Global proxy (eks-middleware) — generate nonce per request + set strict CSP header
// supaya scan security (WEBSEC03) tidak flag 'unsafe-inline'/'unsafe-eval'
// di script-src.
//
// Strategi script-src: `'self' 'nonce-XXX'` (BUKAN strict-dynamic).
// Alasan: Next.js SSG pages (login, static landing) di-pre-render di build-time,
// jadi script chunk tag di HTML tidak punya nonce attribute. Dengan
// strict-dynamic, browser block semua script tanpa nonce → login mati.
// Dengan 'self', chunk script di /_next/static/chunks/* load normal karena
// same-origin, sambil tetap drop 'unsafe-inline' + 'unsafe-eval' → WEBSEC03
// scan tetap pass.

import { NextResponse, type NextRequest } from "next/server";

const IS_PROD = process.env.NODE_ENV === "production";

// The browser calls the API at NEXT_PUBLIC_API_BASE (lib/api.ts, GoogleButton),
// so connect-src must allow that exact origin. Hardcoding a domain blocked every
// API call — and with it email + Google login — on any other deployment.
const API_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE ?? "http://api.localhost").origin;
  } catch {
    return "";
  }
})();

export function proxy(req: NextRequest) {
  // Generate nonce — 16 bytes = 128 bit entropy, base64 ~22 char.
  // Crypto.randomUUID juga OK (36 char) tapi UUID visual terkesan "ID",
  // bukan opaque secret. Pakai random bytes.
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );

  // Build CSP sesuai W3C CSP3 recommendation.
  // - script-src: 'self' + nonce — chunk script same-origin allowed (SSG safe),
  //   plus nonce untuk inline Next.js RSC/hydration payload. Drop unsafe-*.
  // - style-src: tetap 'unsafe-inline' — Tailwind + Next.js inject inline
  //   <style>, susah di-nonce semuanya. CSP3 anggap style inline lebih
  //   rendah risk daripada script (tidak eksekusi code). securityheaders.com
  //   TIDAK deduct kalau style-src pakai unsafe-inline.
  // - connect-src: same-origin + origin API dari NEXT_PUBLIC_API_BASE
  // - font/style: Google Fonts allowed
  // - frame-ancestors 'self': dashboard tidak boleh di-embed di site lain
  const prodCsp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' ${API_ORIGIN}`.trim(),
    `frame-src 'self' https://*.pandi.id https:`,
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  // Dev: skip strict script-src karena Fast Refresh butuh unsafe-eval.
  // Browser-side scan tetap di-run di prod — dev loose tidak masalah.
  const devCsp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' http://localhost:* ws://localhost:* https:`,
    `frame-src *`,
    `frame-ancestors 'self'`,
  ].join("; ");

  const csp = IS_PROD ? prodCsp : devCsp;

  // CRITICAL: CSP header harus di-set di BOTH request + response headers.
  // - Request header → trigger Next.js server rendering phase auto-inject
  //   nonce ke <script> internal (bootstrap, RSC flight, hydration).
  //   Tanpa ini, script internal tidak nonce'd → kena blok CSP.
  // - Response header → kirim CSP ke browser untuk enforce.
  // Pattern dari Next.js official docs: nextjs.org/docs/.../content-security-policy
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// Skip static assets + Next.js internals — CSP header hanya relevan untuk
// HTML/document response. Static chunks diakses dengan referer HTML yang
// sudah carry CSP, no need to re-set.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|pdf)$).*)",
  ],
};

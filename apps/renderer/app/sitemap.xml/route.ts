// Dynamic sitemap.xml per host — Next.js multi-tenant renderer resolve site
// dari `Host` header, lalu enumerate: home + pages + blog + products.
//
// Kenapa custom route (bukan Next.js `app/sitemap.ts` convention): sitemap
// convention di-generate compile-time single-tenant; kita perlu request-time
// karena setiap Host = tenant berbeda.
//
// CRITICAL: Konten route ini HOST-DEPENDENT. Sebelumnya pakai `revalidate=300`
// yang bikin Next.js ISR cache result keyed by URL saja (tidak include Host).
// Result: domain A hit /sitemap.xml → cached; domain B hit /sitemap.xml →
// dapat cached sitemap domain A (URL milik domain lain) → **CROSS-TENANT LEAK**.
// Fix: force-dynamic (skip ISR cache) + Vary: Host header (untuk downstream
// cache seperti Caddy/CDN). Backend hit tetap murah karena listPages punya
// cache 1-5s di sisi API.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  getSiteByHost,
  listPages,
  listBlogPosts,
  listProducts,
} from "@/lib/api";

export async function GET() {
  const host = (await headers()).get("host") ?? "";
  const site = await getSiteByHost(host);
  if (!site) {
    return new NextResponse("Site not found", { status: 404 });
  }

  const baseURL = `https://${host}`;
  const now = new Date().toISOString();

  const urls: Array<{ loc: string; lastmod?: string; priority?: number; changefreq?: string }> = [];

  // Root/home — priority 1.
  urls.push({ loc: `${baseURL}/`, lastmod: now, priority: 1.0, changefreq: "weekly" });

  // Sub-pages — priority 0.8. Skip home page karena sudah di-cover root.
  try {
    const pages = await listPages(site.id);
    for (const p of pages) {
      if (p.is_home) continue;
      urls.push({
        loc: `${baseURL}/${p.slug}`,
        lastmod: now,
        priority: 0.8,
        changefreq: "monthly",
      });
    }
  } catch {
    /* pages endpoint down — skip section */
  }

  // Blog posts — priority 0.6.
  try {
    const posts = await listBlogPosts(site.id, 200);
    for (const post of posts) {
      urls.push({
        loc: `${baseURL}/blog/${post.slug}`,
        lastmod: post.published_at ?? now,
        priority: 0.6,
        changefreq: "weekly",
      });
    }
  } catch {
    /* blog optional — skip */
  }

  // Products — priority 0.7.
  try {
    const products = await listProducts(site.id, 500);
    for (const prod of products) {
      urls.push({
        loc: `${baseURL}/produk/${prod.slug}`,
        lastmod: now,
        priority: 0.7,
        changefreq: "weekly",
      });
    }
  } catch {
    /* products optional */
  }

  const xml = renderSitemap(urls);
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Cache-Control tetap ada supaya downstream cache (Caddy/CDN) bisa
      // dedup, TAPI harus disertai Vary: Host — kalau tidak, cache key
      // collapse ke URL saja dan cross-tenant kalau 2 domain hit sitemap
      // dalam window cache yang sama.
      "Cache-Control": "public, max-age=60, s-maxage=300",
      Vary: "Host",
    },
  });
}

function renderSitemap(
  urls: Array<{ loc: string; lastmod?: string; priority?: number; changefreq?: string }>,
): string {
  const items = urls
    .map(
      (u) => `  <url>
    <loc>${escapeXML(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${escapeXML(u.lastmod)}</lastmod>` : ""}
    ${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ""}
    ${u.priority != null ? `<priority>${u.priority.toFixed(1)}</priority>` : ""}
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>`;
}

function escapeXML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

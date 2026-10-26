// SiteLayout — shared header/footer render helper. Dipakai detail pages
// (blog) yang tidak render via RenderBlocks langsung.
// Layout kosong `{}` → tidak render apa-apa (backward compat sites lama).
//
// Untuk full-page render (catch-all + home), pakai `composePageWithLayout`
// yang concat header + page (setelah defensive strip) + footer jadi satu
// blocks array untuk RenderBlocks.

import { RenderBlocks } from "@/components/Blocks";
import type { Block, Site } from "@/lib/api";

// Block type yang di-manage oleh shared layout. Kalau muncul di top-level
// page tree saat layout section aktif, harus di-strip supaya tidak double
// render (mirror editor `hiddenLayoutIndices` di apps/web).
const LAYOUT_HEADER_TYPES = new Set(["Navbar"]);
const LAYOUT_FOOTER_TYPES = new Set(["Footer"]);

// isEnabled: default true kalau field tidak ada (backward compat site lama).
// Konsumer opt out dengan set eksplisit `false`.
function isEnabled(flag: boolean | undefined): boolean {
  return flag !== false;
}

export function SiteHeaderBlocks({ site }: { site: Site }) {
  const blocks = site.layout?.header ?? [];
  if (blocks.length === 0 || !isEnabled(site.layout?.header_enabled)) return null;
  return <RenderBlocks blocks={blocks} siteId={site.id} />;
}

export function SiteFooterBlocks({ site }: { site: Site }) {
  const blocks = site.layout?.footer ?? [];
  if (blocks.length === 0 || !isEnabled(site.layout?.footer_enabled)) return null;
  return <RenderBlocks blocks={blocks} siteId={site.id} />;
}

// composePageWithLayout — bangun final blocks array untuk full-page render.
// Tiga langkah:
//   1. Cek flag enabled untuk header + footer
//   2. Defensive strip: hilangkan Navbar dari page.tree kalau
//      header active + populated. Sama untuk Footer. Cegah render dobel
//      walaupun page.tree.blocks masih punya residual dari edit lama,
//      template yang bocor, atau migration yang skip page tertentu.
//   3. Concat header + stripped page + footer
//
// Dipakai catch-all + homepage. Detail routes (blog)
// pakai SiteHeaderBlocks/SiteFooterBlocks helper yang tidak strip (karena
// halaman detail tidak render page.tree.blocks — konten dari post).
export function composePageWithLayout(site: Site, pageBlocks: Block[]): Block[] {
  const headerEnabled = isEnabled(site.layout?.header_enabled);
  const footerEnabled = isEnabled(site.layout?.footer_enabled);
  const headerBlocks = headerEnabled ? site.layout?.header ?? [] : [];
  const footerBlocks = footerEnabled ? site.layout?.footer ?? [] : [];
  const headerActive = headerBlocks.length > 0;
  const footerActive = footerBlocks.length > 0;
  const stripped = pageBlocks.filter((b) => {
    if (headerActive && LAYOUT_HEADER_TYPES.has(b.type)) return false;
    if (footerActive && LAYOUT_FOOTER_TYPES.has(b.type)) return false;
    return true;
  });
  return [...headerBlocks, ...stripped, ...footerBlocks];
}

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { RenderBlocks } from "@/components/Blocks";
import { SiteBodyEndCode, SiteHeadCode } from "@/components/CustomCode";
import { composePageWithLayout } from "@/components/SiteLayout";
import { PageViewBeacon } from "@/components/PageViewBeacon";
import { getPage, getSiteByHost } from "@/lib/api";
import { googleFontsUrl, themeToCss } from "@/lib/theme";
import { buildOrganization, buildWebSite, wrap } from "@/lib/schema";

export const dynamic = "force-dynamic";

export default async function CatchAll(props: { params: Promise<{ slug: string[] }> }) {
  const params = await props.params;
  const host = ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
  const site = await getSiteByHost(host);
  if (!site) notFound();
  const slug = params.slug.join("/");
  const page = await getPage(site.id, slug);
  if (!page) notFound();
  // Compose blocks — helper handle: cek flag enabled, defensive strip
  // Navbar/Footer duplikat di page.tree (kalau layout section active),
  // prepend header + append footer. Cegah "2 header" walaupun page.tree
  // masih punya residual dari edit lama / migration miss / template bocor.
  const blocks = composePageWithLayout(site, page.tree?.blocks ?? []);
  const fontHref = googleFontsUrl(site.theme);
  // Schema.org JSON-LD — inject WebSite + Organization di homepage, Organization
  // saja di sub-pages (WebSite cukup 1x per site sesuai Google guideline).
  const baseURL = `https://${host}`;
  const schemas = page.is_home
    ? [buildWebSite(site, baseURL), buildOrganization(site, baseURL)]
    : [buildOrganization(site, baseURL)];
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeToCss(site.theme) }} />
      {fontHref ? <link rel="stylesheet" href={fontHref} /> : null}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: wrap(schemas) }}
      />
      <SiteHeadCode site={site} />
      <RenderBlocks blocks={blocks} siteId={site.id} />
      <PageViewBeacon siteId={site.id} pageSlug={page.is_home ? "" : slug} />
      <SiteBodyEndCode site={site} />
    </>
  );
}

export async function generateMetadata(props: { params: Promise<{ slug: string[] }> }) {
  const params = await props.params;
  const host = ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
  const site = await getSiteByHost(host);
  if (!site) return {};
  const slug = params.slug.join("/");
  const page = await getPage(site.id, slug);
  if (!page) return {};
  const seo = page.seo ?? {};
  const title = seo.title || page.title || site.name;
  const description = seo.description || "";
  const og = seo.ogImage || undefined;
  return {
    title,
    description,
    robots: seo.noindex ? { index: false, follow: false } : undefined,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    openGraph: {
      title,
      description,
      type: "website",
      images: og ? [{ url: og }] : undefined,
      siteName: site.name,
    },
    twitter: {
      card: og ? "summary_large_image" : "summary",
      title,
      description,
      images: og ? [og] : undefined,
    },
  };
}

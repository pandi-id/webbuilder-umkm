import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { marked } from "@/lib/markdown";
import { getBlogPost, getSiteByHost } from "@/lib/api";
import { googleFontsUrl, themeToCss } from "@/lib/theme";
import { buildArticle, wrap } from "@/lib/schema";
import { PageViewBeacon } from "@/components/PageViewBeacon";
import { SiteBodyEndCode, SiteHeadCode } from "@/components/CustomCode";
import { SiteFooterBlocks, SiteHeaderBlocks } from "@/components/SiteLayout";

export const dynamic = "force-dynamic";

async function host() {
  return ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
}

// XSS hardening:
// - GFM enabled for markdown features (tables, strikethrough, autolinks).
// - Raw HTML in source is DROPPED (renderer override return "").
// - Fenced code block bahasa `youtube` / `audio` → di-render sebagai iframe
//   / <audio> via custom code renderer di @/lib/markdown. Fence itu
//   di-produksi editor (bukan raw HTML user) jadi tetap aman.
// - Kalau butuh allow subset HTML lain (mis. <img width/height>), pipe
//   marked output ke DOMPurify / sanitize-html sebagai layer tambahan.

export default async function BlogPostDetail(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const site = await getSiteByHost(await host());
  if (!site) notFound();
  const post = await getBlogPost(site.id, params.slug);
  if (!post) notFound();

  const fontHref = googleFontsUrl(site.theme);
  const html = await marked.parse(post.content_md ?? "");
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const baseURL = `https://${await host()}`;
  const articleLD = wrap([buildArticle(post, site, baseURL)]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeToCss(site.theme) }} />
      {fontHref ? <link rel="stylesheet" href={fontHref} /> : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleLD }} />
      <SiteHeadCode site={site} />
      <PageViewBeacon siteId={site.id} pageSlug={`/blog/${params.slug}`} />
      <SiteHeaderBlocks site={site} />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <nav className="mb-6 text-sm opacity-70">
          <a href="/" className="hover:underline">
            ← Beranda
          </a>
        </nav>

        {post.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_url}
            alt={post.title}
            fetchPriority="high"
            decoding="async"
            className="mb-6 aspect-[2/1] w-full rounded-xl object-cover"
          />
        )}

        <h1 className="text-4xl font-bold leading-tight">{post.title}</h1>

        <div className="mt-3 flex items-center gap-3 text-sm opacity-70">
          {post.author_name && <span>{post.author_name}</span>}
          {post.author_name && post.published_at && <span>·</span>}
          {post.published_at && (
            <time dateTime={post.published_at}>
              {new Date(post.published_at).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </time>
          )}
        </div>

        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {tags.map((t, i) => (
              <span key={i} className="rounded-full border px-2.5 py-0.5 text-xs opacity-80">
                {t}
              </span>
            ))}
          </div>
        )}

        <article
          className="wb-prose mt-8"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
      <SiteFooterBlocks site={site} />
      <SiteBodyEndCode site={site} />
    </>
  );
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const site = await getSiteByHost(await host());
  if (!site) return {};
  const post = await getBlogPost(site.id, params.slug);
  if (!post) return {};
  return {
    title: `${post.title} — ${site.name}`,
    description: post.excerpt.slice(0, 160),
  };
}

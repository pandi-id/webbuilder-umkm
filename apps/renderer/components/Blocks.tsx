import { marked } from "marked";
import { formatPrice, getPublicForm, listBlogPosts, listProducts, type Block } from "@/lib/api";
import { FormBlock } from "@/components/FormBlock";
import { liveUmkmCtx, renderUmkmBlock } from "@/components/umkm/UmkmBlocks";
import { UMKM_SAMPLE_PRODUCTS, formatRupiah, type UmkmCard } from "@/lib/umkm";

// marked configured once at module scope — strips raw HTML so a malicious
// markdown payload (`<script>`) can't leak through. Matches the blog renderer
// hardening at apps/renderer/app/blog/[slug]/page.tsx.
marked.setOptions({ gfm: true, breaks: false });
marked.use({ renderer: { html: () => "" } });

function renderMarkdownSafe(md: string): string {
  if (!md) return "";
  return marked.parse(md, { async: false }) as string;
}

// Tailwind-equivalent max-width presets — must match editor's blockLayout.ts.
const MAX_WIDTH_PX: Record<string, string> = {
  full: "100%",
  wide: "1280px",
  narrow: "640px",
  prose: "720px",
};

// Generate a unique class name for a block's wrapper. Used to scope responsive
// @media rules without colliding across blocks. `i` is the block index in the
// tree — stable within a single render pass.
function blockClass(i: number): string {
  return `wb-blk-${i}`;
}

// Render the per-block @media CSS for a single block. Mobile/base is applied
// inline (via wrapper style); this only emits the tablet/desktop overrides
// and visibility-hidden rules.
function blockMediaCSS(klass: string, layout: Block["layout"]): string {
  if (!layout) return "";
  const parts: string[] = [];
  const t = layout.responsive?.tablet;
  if (t) {
    const css = patchToCSS(t);
    const inner = patchInnerCSS(klass, t);
    if (css || inner) {
      parts.push(`@media (min-width:768px){.${klass}{${css}}${inner}}`);
    }
  }
  const d = layout.responsive?.desktop;
  if (d) {
    const css = patchToCSS(d);
    const inner = patchInnerCSS(klass, d);
    if (css || inner) {
      parts.push(`@media (min-width:1024px){.${klass}{${css}}${inner}}`);
    }
  }
  if (layout.hidden?.mobile) {
    parts.push(`@media (max-width:767px){.${klass}{display:none!important}}`);
  }
  if (layout.hidden?.tablet) {
    parts.push(`@media (min-width:768px) and (max-width:1023px){.${klass}{display:none!important}}`);
  }
  if (layout.hidden?.desktop) {
    parts.push(`@media (min-width:1024px){.${klass}{display:none!important}}`);
  }
  return parts.join("");
}

function patchToCSS(p: NonNullable<NonNullable<Block["layout"]>["responsive"]>["tablet"]): string {
  if (!p) return "";
  const out: string[] = [];
  if (p.pt != null) out.push(`padding-top:${p.pt}rem`);
  if (p.pr != null) out.push(`padding-right:${p.pr}rem`);
  if (p.pb != null) out.push(`padding-bottom:${p.pb}rem`);
  if (p.pl != null) out.push(`padding-left:${p.pl}rem`);
  if (p.mt != null) out.push(`margin-top:${p.mt}rem`);
  if (p.mb != null) out.push(`margin-bottom:${p.mb}rem`);
  if (p.align) out.push(`text-align:${p.align}`);
  if (p.bg) out.push(`background-color:${p.bg}`);
  return out.join(";");
}

function patchInnerCSS(
  klass: string,
  p: NonNullable<NonNullable<Block["layout"]>["responsive"]>["tablet"],
): string {
  if (!p?.maxWidth) return "";
  const w = MAX_WIDTH_PX[p.maxWidth];
  if (!w) return "";
  return `.${klass} .wb-blk-inner{max-width:${w}}`;
}

// Build wrapper + inner styles from a block's layout/themeOverride meta. The
// editor's lib/blockLayout.ts is the source of truth — keep this in sync.
function layoutWrapperStyle(b: Block): React.CSSProperties | undefined {
  const out: Record<string, string> = {};
  const L = b.layout;
  if (L) {
    if (L.pt != null) out.paddingTop = `${L.pt}rem`;
    if (L.pr != null) out.paddingRight = `${L.pr}rem`;
    if (L.pb != null) out.paddingBottom = `${L.pb}rem`;
    if (L.pl != null) out.paddingLeft = `${L.pl}rem`;
    if (L.mt != null) out.marginTop = `${L.mt}rem`;
    if (L.mb != null) out.marginBottom = `${L.mb}rem`;
    if (L.bg) out.backgroundColor = L.bg;
    if (L.align) out.textAlign = L.align;
  }
  const O = b.themeOverride;
  if (O) {
    if (O.primary) out["--color-primary"] = O.primary;
    if (O.secondary) out["--color-secondary"] = O.secondary;
    if (O.bg) {
      out["--color-bg"] = O.bg;
      // Paint the actual wrapper bg so blocks without `bg-background`
      // (most of them) visibly take on the override.
      if (!out.backgroundColor) out.backgroundColor = O.bg;
    }
    if (O.fg) {
      out["--color-fg"] = O.fg;
      out.color = O.fg;
    }
  }
  return Object.keys(out).length ? (out as React.CSSProperties) : undefined;
}

function maxWidthInnerStyle(b: Block): React.CSSProperties | undefined {
  const mw = b.layout?.maxWidth;
  if (!mw || mw === "full") return undefined;
  return {
    maxWidth: MAX_WIDTH_PX[mw] ?? "100%",
    marginLeft: "auto",
    marginRight: "auto",
    width: "100%",
  };
}

/**
 * Wrap a block in its layout container. Returns the bare block unchanged when
 * no metadata is set, so the output for the typical case stays clean. Always
 * applies the unique class name so the @media stylesheet can target it.
 */
function withLayout(b: Block, key: number, content: React.ReactNode): React.ReactNode {
  const wrap = layoutWrapperStyle(b);
  const inner = maxWidthInnerStyle(b);
  const klass = blockClass(key);
  if (!wrap && !inner) return <div key={key} className={klass}>{content}</div>;
  return (
    <div key={key} className={klass} style={wrap}>
      {inner ? <div className="wb-blk-inner" style={inner}>{content}</div> : content}
    </div>
  );
}

export async function RenderBlocks({
  blocks,
  siteId,
}: {
  blocks: Block[];
  siteId: string;
}) {
  // Build the per-page responsive stylesheet once — one `<style>` with rules
  // for every block that has tablet/desktop overrides or hidden flags.
  const responsiveCSS = blocks
    .map((b, i) => blockMediaCSS(blockClass(i), b.layout))
    .filter(Boolean)
    .join("");

  const nodes = blocks.map((b, i) => withLayout(b, i, <BlockNode block={b} siteId={siteId} />));

  return (
    <>
      {responsiveCSS && (
        <style dangerouslySetInnerHTML={{ __html: responsiveCSS }} />
      )}
      {nodes}
    </>
  );
}

// BlockNode routes data-backed blocks to their async server components. Used
// for top-level and nested (Container/Columns) children alike, so a catalog
// inside a container still receives the site ID.
function BlockNode({ block, siteId }: { block: Block; siteId: string }) {
  switch (block.type) {
    case "ProductGridDynamic":
      return <ProductGridDynamic block={block} siteId={siteId} />;
    case "BlogListDynamic":
      return <BlogListDynamicAsync block={block} siteId={siteId} />;
    case "Form":
      return <FormBlockAsync block={block} />;
    case "UmkmCatalogDynamic":
      return <UmkmCatalogDynamic block={block} siteId={siteId} />;
    default:
      return <BlockView block={block} siteId={siteId} />;
  }
}

function BlockView({ block, siteId }: { block: Block; siteId: string }) {
  const p = block.props ?? {};
  switch (block.type) {
    case "Navbar":
      return (
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <strong className="text-lg">{String(p.brand ?? "")}</strong>
            <nav className="flex gap-6 text-sm">
              {(p.links as Array<{ label: string; href: string }> | undefined)?.map((l, i) => (
                <a key={i} href={l.href} className="hover:underline">
                  {l.label}
                </a>
              ))}
            </nav>
          </div>
        </header>
      );
    case "Hero":
      return (
        <section className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h1 className="text-5xl font-bold tracking-tight">{String(p.title ?? "")}</h1>
          {p.subtitle ? <p className="mx-auto mt-4 max-w-2xl text-lg opacity-80">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a
              href={String(p.ctaHref ?? "#")}
              className="btn-primary mt-8 inline-block px-6 py-3 font-medium"
            >
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </section>
      );
    case "Heading":
      return (
        <h2 className="mx-auto max-w-5xl px-6 py-6 text-3xl font-bold">
          {String(p.text ?? "")}
        </h2>
      );
    case "Text":
      return (
        <p className="mx-auto max-w-3xl whitespace-pre-line px-6 py-2">
          {String(p.body ?? "")}
        </p>
      );
    case "RichText": {
      const html = renderMarkdownSafe(String(p.body ?? ""));
      return (
        <div
          className="wb-prose mx-auto max-w-3xl px-6 py-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    case "Section":
      return (
        <section className="mx-auto max-w-5xl px-6 py-10">
          {p.title ? <h3 className="text-2xl font-semibold">{String(p.title)}</h3> : null}
          <p className="mt-3 whitespace-pre-line opacity-80">{String(p.body ?? "")}</p>
        </section>
      );
    case "FeatureList":
      return (
        <section className="mx-auto max-w-5xl px-6 py-10">
          {p.title ? <h3 className="mb-6 text-2xl font-semibold">{String(p.title)}</h3> : null}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.map((it, i) => (
              <div key={i} className="rounded-xl border p-5">
                <div className="font-semibold">{it.title}</div>
                <div className="mt-1 text-sm opacity-80">{it.desc}</div>
              </div>
            ))}
          </div>
        </section>
      );
    case "ProductGrid":
      return (
        <section className="mx-auto max-w-5xl px-6 py-10">
          {p.title ? <h3 className="mb-6 text-2xl font-semibold">{String(p.title)}</h3> : null}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(p.items as Array<{ name: string; price: string; image?: string }> | undefined)?.map((it, i) => (
              <div key={i} className="overflow-hidden rounded-xl border">
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.image}
                    alt={it.name}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="aspect-square bg-slate-100" />
                )}
                <div className="p-4">
                  <div className="font-medium">{it.name}</div>
                  <div className="mt-1 text-sm opacity-80">{it.price}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    case "ProjectGrid":
      return (
        <section className="mx-auto max-w-5xl px-6 py-10">
          {p.title ? <h3 className="mb-6 text-2xl font-semibold">{String(p.title)}</h3> : null}
          <div className="grid gap-6 sm:grid-cols-2">
            {(p.items as Array<{ name: string; desc: string; href: string }> | undefined)?.map((it, i) => (
              <a key={i} href={it.href} className="rounded-xl border p-5 transition hover:shadow-md">
                <div className="font-semibold">{it.name}</div>
                <div className="mt-1 text-sm opacity-80">{it.desc}</div>
              </a>
            ))}
          </div>
        </section>
      );
    case "BlogList":
      return (
        <section className="mx-auto max-w-3xl px-6 py-10">
          {(p.items as Array<{ title: string; excerpt: string; href: string }> | undefined)?.map((it, i) => (
            <a key={i} href={it.href} className="mb-6 block border-b pb-6 last:border-0">
              <h3 className="text-xl font-semibold">{it.title}</h3>
              <p className="mt-1 opacity-80">{it.excerpt}</p>
            </a>
          ))}
        </section>
      );
    case "Testimonial":
      return (
        <section className="mx-auto max-w-3xl px-6 py-10">
          {(p.items as Array<{ name: string; text: string }> | undefined)?.map((t, i) => (
            <blockquote key={i} className="my-4 border-l-4 pl-5 italic" style={{ borderColor: "var(--color-primary)" }}>
              “{t.text}” — <span className="not-italic font-medium">{t.name}</span>
            </blockquote>
          ))}
        </section>
      );
    case "Footer":
      return (
        <footer className="mt-16 border-t">
          <div className="mx-auto max-w-5xl px-6 py-6 text-center text-sm opacity-70">
            {String(p.copyright ?? "")}
          </div>
        </footer>
      );

    case "HeroSpotlight":
      return (
        <section className="relative isolate overflow-hidden">
          {/* animated gradient spotlight */}
          <div className="absolute inset-0 -z-10">
            <div
              className="absolute left-1/2 top-0 -z-10 h-[600px] w-[1000px] -translate-x-1/2 opacity-40 blur-3xl wb-spotlight-anim"
              style={{
                background:
                  "radial-gradient(closest-side, var(--color-primary), transparent 70%)",
              }}
            />
            <div className="absolute inset-0 wb-grid-pattern opacity-20" />
          </div>
          <div className="mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
            {p.eyebrow ? (
              <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wider opacity-80">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {String(p.eyebrow)}
              </div>
            ) : null}
            <h1 className="text-balance text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
              {String(p.title ?? "")}
            </h1>
            {p.subtitle ? (
              <p className="mx-auto mt-6 max-w-2xl text-balance text-lg opacity-80 sm:text-xl">
                {String(p.subtitle)}
              </p>
            ) : null}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {p.ctaLabel ? (
                <a
                  href={String(p.ctaHref ?? "#")}
                  className="btn-primary inline-flex items-center gap-2 px-6 py-3 font-medium shadow-lg shadow-primary/20 transition-all hover:scale-105"
                >
                  {String(p.ctaLabel)} →
                </a>
              ) : null}
              {p.ctaSecondaryLabel ? (
                <a
                  href={String(p.ctaSecondaryHref ?? "#")}
                  className="inline-flex items-center gap-2 rounded-[var(--radius)] border px-6 py-3 font-medium transition-colors hover:bg-foreground/5"
                >
                  {String(p.ctaSecondaryLabel)}
                </a>
              ) : null}
            </div>
          </div>
        </section>
      );

    case "BentoGrid": {
      const items =
        (p.items as Array<{ title: string; desc: string; size?: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-5xl px-6 py-16">
          {p.title ? (
            <h3 className="mb-10 text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <div className="grid auto-rows-[10rem] grid-cols-1 gap-4 sm:grid-cols-3">
            {items.map((it, i) => {
              const span =
                it.size === "large"
                  ? "sm:col-span-2 sm:row-span-2"
                  : it.size === "wide"
                    ? "sm:col-span-2"
                    : it.size === "tall"
                      ? "sm:row-span-2"
                      : "";
              return (
                <div
                  key={i}
                  className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-foreground/[0.02] to-foreground/[0.06] p-6 transition-all hover:border-primary/40 hover:shadow-lg ${span}`}
                >
                  <div
                    className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-0 blur-2xl transition-opacity group-hover:opacity-30"
                    style={{ background: "var(--color-primary)" }}
                  />
                  <h4 className="text-lg font-semibold">{it.title}</h4>
                  <p className="mt-2 text-sm opacity-80">{it.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      );
    }

    case "StatsBar": {
      const items =
        (p.items as Array<{ value: string; label: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-5xl px-6 py-12">
          <div className="grid grid-cols-2 gap-y-8 rounded-2xl border bg-gradient-to-br from-foreground/[0.02] to-transparent p-8 sm:grid-cols-4">
            {items.map((it, i) => (
              <div key={i} className="text-center">
                <div
                  className="text-4xl font-bold tracking-tight sm:text-5xl"
                  style={{ color: "var(--color-primary)" }}
                >
                  {it.value}
                </div>
                <div className="mt-1 text-sm uppercase tracking-wider opacity-70">
                  {it.label}
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "LogoCloud": {
      const items =
        (p.items as Array<{ name: string; image?: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-5xl px-6 py-12">
          {p.title ? (
            <p className="mb-8 text-center text-sm font-medium uppercase tracking-widest opacity-70">
              {String(p.title)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
            {items.map((it, i) =>
              it.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={it.image}
                  alt={it.name}
                  loading="lazy"
                  decoding="async"
                  className="h-8 opacity-60 grayscale transition-all hover:opacity-100 hover:grayscale-0"
                />
              ) : (
                <span
                  key={i}
                  className="text-lg font-semibold tracking-tight opacity-50 transition-opacity hover:opacity-100"
                >
                  {it.name}
                </span>
              ),
            )}
          </div>
        </section>
      );
    }

    case "CTABanner":
      return (
        <section className="px-6 py-12">
          <div
            className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl px-8 py-16 text-center text-white"
            style={{
              background:
                "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
            }}
          >
            <div className="pointer-events-none absolute inset-0 wb-grid-pattern opacity-10" />
            <h2 className="relative text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              {String(p.title ?? "")}
            </h2>
            {p.subtitle ? (
              <p className="relative mx-auto mt-3 max-w-2xl text-balance opacity-90">
                {String(p.subtitle)}
              </p>
            ) : null}
            {p.ctaLabel ? (
              <a
                href={String(p.ctaHref ?? "#")}
                className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 font-medium text-foreground shadow-xl transition-all hover:scale-105"
              >
                {String(p.ctaLabel)} →
              </a>
            ) : null}
          </div>
        </section>
      );

    case "PricingTable": {
      const items =
        (p.items as Array<{
          title: string;
          price: string;
          period?: string;
          desc?: string;
          features?: string;
          ctaLabel?: string;
          ctaHref?: string;
          featured?: string;
        }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-5xl px-6 py-16">
          {p.title ? (
            <h3 className="text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          {p.subtitle ? (
            <p className="mx-auto mt-3 max-w-2xl text-center opacity-70">
              {String(p.subtitle)}
            </p>
          ) : null}
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {items.map((it, i) => {
              const featured = it.featured === "yes" || it.featured === "true";
              const features = (it.features ?? "")
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              return (
                <div
                  key={i}
                  className={`relative flex flex-col rounded-2xl border p-7 transition-all hover:shadow-xl ${
                    featured
                      ? "scale-[1.02] border-2 shadow-lg"
                      : "border-foreground/10"
                  }`}
                  style={featured ? { borderColor: "var(--color-primary)" } : undefined}
                >
                  {featured && (
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-white shadow-md"
                      style={{ background: "var(--color-primary)" }}
                    >
                      Populer
                    </div>
                  )}
                  <h4 className="text-lg font-semibold">{it.title}</h4>
                  {it.desc && (
                    <p className="mt-1 text-sm opacity-70">{it.desc}</p>
                  )}
                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">{it.price}</span>
                    {it.period && (
                      <span className="text-sm opacity-60">{it.period}</span>
                    )}
                  </div>
                  <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                    {features.map((f, j) => (
                      <li key={j} className="flex items-start gap-2">
                        <span
                          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                          style={{
                            background: "var(--color-primary)",
                            color: "white",
                          }}
                        >
                          ✓
                        </span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  {it.ctaLabel && (
                    <a
                      href={it.ctaHref ?? "#"}
                      className={`mt-7 inline-flex items-center justify-center rounded-[var(--radius)] px-5 py-2.5 font-medium transition-all ${
                        featured
                          ? "btn-primary shadow-md hover:scale-[1.02]"
                          : "border hover:bg-foreground/5"
                      }`}
                    >
                      {it.ctaLabel}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      );
    }

    case "FAQ": {
      const items =
        (p.items as Array<{ question: string; answer: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-3xl px-6 py-16">
          {p.title ? (
            <h3 className="text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <div className="mt-10 divide-y rounded-2xl border bg-foreground/[0.01]">
            {items.map((it, i) => (
              <details
                key={i}
                className="group [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left text-base font-medium transition-colors hover:bg-foreground/[0.02]">
                  <span>{it.question}</span>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/5 transition-transform group-open:rotate-180">
                    <svg
                      className="size-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </summary>
                <div className="px-6 pb-5 text-sm opacity-80">{it.answer}</div>
              </details>
            ))}
          </div>
        </section>
      );
    }

    case "TestimonialMarquee": {
      const items =
        (p.items as Array<{ name: string; text: string }> | undefined) ?? [];
      // Duplicate for seamless loop
      const loop = [...items, ...items];
      return (
        <section className="mx-auto max-w-6xl py-16">
          {p.title ? (
            <h3 className="px-6 text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <div className="wb-marquee-mask mt-10 overflow-hidden">
            <div className="wb-marquee flex w-max gap-4">
              {loop.map((t, i) => (
                <div
                  key={i}
                  className="w-[320px] shrink-0 rounded-2xl border bg-foreground/[0.02] p-6"
                >
                  <p className="text-sm leading-relaxed opacity-90">
                    &ldquo;{t.text}&rdquo;
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <div
                      className="grid size-9 place-items-center rounded-full text-sm font-bold text-white"
                      style={{ background: "var(--color-primary)" }}
                    >
                      {t.name.charAt(0)}
                    </div>
                    <div className="text-sm font-semibold">{t.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    // -------------------- New blocks --------------------

    case "HeroSplit": {
      const reversed = String(p.reversed ?? "") === "yes";
      return (
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div
            className={`grid items-center gap-12 lg:grid-cols-2 ${reversed ? "lg:[&>div:first-child]:order-2" : ""}`}
          >
            <div>
              {p.eyebrow ? (
                <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wider opacity-80">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {String(p.eyebrow)}
                </div>
              ) : null}
              <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                {String(p.title ?? "")}
              </h1>
              {p.subtitle ? (
                <p className="mt-5 text-lg opacity-80">{String(p.subtitle)}</p>
              ) : null}
              <div className="mt-8 flex flex-wrap gap-3">
                {p.ctaLabel ? (
                  <a
                    href={String(p.ctaHref ?? "#")}
                    className="btn-primary inline-flex items-center gap-2 px-6 py-3 font-medium shadow-lg transition-all hover:scale-105"
                  >
                    {String(p.ctaLabel)} →
                  </a>
                ) : null}
                {p.ctaSecondaryLabel ? (
                  <a
                    href={String(p.ctaSecondaryHref ?? "#")}
                    className="inline-flex items-center gap-2 rounded-[var(--radius)] border px-6 py-3 font-medium transition-colors hover:bg-foreground/5"
                  >
                    {String(p.ctaSecondaryLabel)}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="relative">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(p.image)}
                  alt=""
                  fetchPriority="high"
                  decoding="async"
                  className="w-full rounded-2xl border shadow-xl"
                />
              ) : (
                <div
                  className="aspect-video w-full rounded-2xl border bg-gradient-to-br from-primary/10 to-primary/5"
                  style={{
                    background:
                      "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 15%, transparent), color-mix(in srgb, var(--color-secondary) 8%, transparent))",
                  }}
                />
              )}
            </div>
          </div>
        </section>
      );
    }

    case "Banner":
      return (
        <div
          className="flex items-center justify-center gap-3 px-6 py-2.5 text-center text-sm text-white"
          style={{ background: "var(--color-primary)" }}
        >
          <span>{String(p.text ?? "")}</span>
          {p.ctaLabel ? (
            <a
              href={String(p.ctaHref ?? "#")}
              className="font-semibold underline underline-offset-2 hover:opacity-90"
            >
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </div>
      );

    case "Divider":
      return (
        <div className="mx-auto max-w-5xl px-6 py-8">
          {p.label ? (
            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-foreground/15" />
              <span className="text-xs font-medium uppercase tracking-widest opacity-60">
                {String(p.label)}
              </span>
              <div className="h-px flex-1 bg-foreground/15" />
            </div>
          ) : (
            <div className="h-px w-full bg-foreground/10" />
          )}
        </div>
      );

    case "Spacer":
      return <div style={{ height: `${Number(p.size ?? 64)}px` }} aria-hidden />;

    case "Container": {
      const children = block.children ?? [];
      const gap = String(p.gap ?? "1rem");
      return (
        <section className="px-6 py-6">
          <div className="mx-auto flex max-w-5xl flex-col" style={{ gap }}>
            {children.map((c, i) => (
              <BlockNode key={i} block={c} siteId={siteId} />
            ))}
          </div>
        </section>
      );
    }

    case "Columns": {
      const children = block.children ?? [];
      const colCount = Math.max(1, Math.min(4, Number(p.columns ?? 2)));
      const gap = String(p.gap ?? "1rem");
      const cells: Block[][] = Array.from({ length: colCount }, () => []);
      children.forEach((c, ci) => {
        cells[ci % colCount].push(c);
      });
      return (
        <section className="px-6 py-6">
          <div
            className="mx-auto grid max-w-5xl max-md:grid-cols-1"
            style={{
              gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
              gap,
            }}
          >
            {cells.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-4">
                {col.map((c, k) => (
                  <BlockNode key={k} block={c} siteId={siteId} />
                ))}
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "Quote":
      return (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div
            className="text-5xl leading-none opacity-30"
            style={{ color: "var(--color-primary)" }}
          >
            ❝
          </div>
          <blockquote className="mt-4 text-balance text-2xl font-medium leading-snug sm:text-3xl">
            {String(p.text ?? "")}
          </blockquote>
          <footer className="mt-6 flex items-center gap-3 text-sm">
            <div
              className="h-0.5 w-10"
              style={{ background: "var(--color-primary)" }}
            />
            <div>
              <div className="font-semibold">{String(p.author ?? "")}</div>
              {p.role ? (
                <div className="opacity-60">{String(p.role)}</div>
              ) : null}
            </div>
          </footer>
        </section>
      );

    case "Alert": {
      const variant = String(p.variant ?? "info");
      const styles: Record<string, { bg: string; border: string; icon: string }> =
        {
          info: { bg: "bg-blue-500/10", border: "border-blue-500/30", icon: "ℹ️" },
          success: {
            bg: "bg-emerald-500/10",
            border: "border-emerald-500/30",
            icon: "✅",
          },
          warning: {
            bg: "bg-amber-500/10",
            border: "border-amber-500/30",
            icon: "⚠️",
          },
          danger: { bg: "bg-red-500/10", border: "border-red-500/30", icon: "❗" },
        };
      const s = styles[variant] ?? styles.info;
      return (
        <section className="mx-auto max-w-3xl px-6 py-6">
          <div className={`flex gap-3 rounded-xl border ${s.bg} ${s.border} p-4`}>
            <span className="text-xl leading-none">{s.icon}</span>
            <div className="flex-1">
              {p.title ? (
                <p className="font-semibold">{String(p.title)}</p>
              ) : null}
              {p.body ? (
                <p className="mt-1 text-sm opacity-80">{String(p.body)}</p>
              ) : null}
            </div>
          </div>
        </section>
      );
    }

    case "FeatureSide": {
      const items =
        (p.items as Array<{ title: string; desc: string; image?: string }> | undefined) ??
        [];
      return (
        <section className="mx-auto max-w-5xl space-y-20 px-6 py-20">
          {items.map((it, i) => {
            const reversed = i % 2 === 1;
            return (
              <div
                key={i}
                className={`grid items-center gap-10 lg:grid-cols-2 ${reversed ? "lg:[&>div:first-child]:order-2" : ""}`}
              >
                <div>
                  <h3 className="text-balance text-3xl font-bold tracking-tight">
                    {it.title}
                  </h3>
                  <p className="mt-3 text-lg opacity-80">{it.desc}</p>
                </div>
                <div className="relative">
                  {it.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full rounded-2xl border shadow-lg"
                    />
                  ) : (
                    <div
                      className="aspect-video w-full rounded-2xl border"
                      style={{
                        background:
                          "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 15%, transparent), color-mix(in srgb, var(--color-secondary) 8%, transparent))",
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>
      );
    }

    case "Timeline": {
      const items =
        (p.items as Array<{ date: string; title: string; desc: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-3xl px-6 py-16">
          {p.title ? (
            <h3 className="mb-12 text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <ol className="relative space-y-8 border-l-2 border-foreground/10 pl-8">
            {items.map((it, i) => (
              <li key={i} className="relative">
                <span
                  className="absolute -left-[42px] grid size-6 place-items-center rounded-full text-xs font-bold text-white shadow-md"
                  style={{ background: "var(--color-primary)" }}
                >
                  {i + 1}
                </span>
                <div
                  className="text-xs font-semibold uppercase tracking-widest opacity-70"
                  style={{ color: "var(--color-primary)" }}
                >
                  {it.date}
                </div>
                <h4 className="mt-1 text-xl font-semibold">{it.title}</h4>
                <p className="mt-1 opacity-80">{it.desc}</p>
              </li>
            ))}
          </ol>
        </section>
      );
    }

    case "ProcessSteps": {
      const items =
        (p.items as Array<{ title: string; desc: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-5xl px-6 py-16">
          {p.title ? (
            <h3 className="text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          {p.subtitle ? (
            <p className="mx-auto mt-3 max-w-2xl text-center opacity-70">
              {String(p.subtitle)}
            </p>
          ) : null}
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {items.map((it, i) => (
              <div key={i} className="relative">
                {i < items.length - 1 && (
                  <div
                    className="absolute left-1/2 top-7 hidden h-0.5 w-full sm:block"
                    style={{
                      background:
                        "linear-gradient(to right, var(--color-primary), transparent)",
                    }}
                  />
                )}
                <div
                  className="relative mx-auto grid size-14 place-items-center rounded-2xl text-xl font-bold text-white shadow-lg"
                  style={{ background: "var(--color-primary)" }}
                >
                  {i + 1}
                </div>
                <h4 className="mt-4 text-center text-lg font-semibold">{it.title}</h4>
                <p className="mt-1 text-center text-sm opacity-80">{it.desc}</p>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "TeamGrid": {
      const items =
        (p.items as Array<{ name: string; role: string; image?: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-5xl px-6 py-16">
          {p.title ? (
            <h3 className="text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          {p.subtitle ? (
            <p className="mx-auto mt-3 max-w-2xl text-center opacity-70">
              {String(p.subtitle)}
            </p>
          ) : null}
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((it, i) => (
              <div key={i} className="text-center">
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.image}
                    alt={it.name}
                    loading="lazy"
                    decoding="async"
                    width={128}
                    height={128}
                    className="mx-auto size-32 rounded-full border-4 border-background object-cover shadow-lg"
                  />
                ) : (
                  <div
                    className="mx-auto grid size-32 place-items-center rounded-full text-3xl font-bold text-white shadow-lg"
                    style={{ background: "var(--color-primary)" }}
                  >
                    {it.name?.charAt(0) ?? "?"}
                  </div>
                )}
                <h4 className="mt-4 font-semibold">{it.name}</h4>
                <p
                  className="text-sm opacity-70"
                  style={{ color: "var(--color-primary)" }}
                >
                  {it.role}
                </p>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "IconList": {
      const items =
        (p.items as Array<{ icon: string; text: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-3xl px-6 py-12">
          {p.title ? (
            <h3 className="mb-6 text-2xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <ul className="space-y-3">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                  style={{ background: "var(--color-primary)" }}
                >
                  {it.icon}
                </span>
                <span className="pt-0.5">{it.text}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    case "StatsCard":
      return (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-3xl border bg-gradient-to-br from-foreground/[0.02] to-transparent p-12 text-center">
            <div
              className="text-7xl font-bold tracking-tight sm:text-8xl"
              style={{ color: "var(--color-primary)" }}
            >
              {String(p.value ?? "")}
            </div>
            <div className="mt-4 text-lg font-semibold uppercase tracking-widest opacity-80">
              {String(p.label ?? "")}
            </div>
            {p.desc ? (
              <p className="mx-auto mt-4 max-w-xl text-sm opacity-70">
                {String(p.desc)}
              </p>
            ) : null}
          </div>
        </section>
      );

    case "VideoEmbed":
      return (
        <section className="mx-auto max-w-4xl px-6 py-12">
          {p.title ? (
            <h3 className="mb-6 text-center text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <div className="aspect-video overflow-hidden rounded-2xl border shadow-xl">
            <iframe
              src={String(p.src ?? "")}
              className="size-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </section>
      );

    case "Map":
      return (
        <section className="mx-auto max-w-5xl px-6 py-12">
          {p.title ? (
            <h3 className="mb-6 text-2xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <div className="aspect-[16/9] overflow-hidden rounded-2xl border shadow-md">
            <iframe
              src={String(p.src ?? "")}
              className="size-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </section>
      );

    case "Gallery": {
      const items =
        (p.items as Array<{ image?: string; caption?: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-6xl px-6 py-12">
          {p.title ? (
            <h3 className="mb-8 text-3xl font-bold tracking-tight">
              {String(p.title)}
            </h3>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
            {items.map((it, i) => (
              <figure
                key={i}
                className="group relative overflow-hidden rounded-lg border bg-muted/30"
              >
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.image}
                    alt={it.caption ?? ""}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                ) : (
                  <div className="aspect-square bg-foreground/5" />
                )}
                {it.caption ? (
                  <figcaption className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/70 to-transparent p-3 text-xs text-white transition-transform group-hover:translate-y-0">
                    {it.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      );
    }

    case "SocialLinks": {
      const items =
        (p.items as Array<{ platform: string; href: string }> | undefined) ?? [];
      return (
        <section className="mx-auto max-w-3xl px-6 py-10 text-center">
          {p.title ? (
            <p className="mb-4 text-sm font-medium uppercase tracking-widest opacity-70">
              {String(p.title)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-3">
            {items.map((it, i) => (
              <a
                key={i}
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={it.platform}
                className="grid size-11 place-items-center rounded-full border bg-card transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
                style={{ color: "var(--color-primary)" }}
              >
                <span dangerouslySetInnerHTML={{ __html: socialIcon(it.platform) }} />
              </a>
            ))}
          </div>
        </section>
      );
    }

    case "Newsletter":
      return (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-3xl border bg-gradient-to-br from-foreground/[0.02] to-transparent p-10 text-center">
            <h3 className="text-balance text-3xl font-bold tracking-tight">
              {String(p.title ?? "")}
            </h3>
            {p.subtitle ? (
              <p className="mx-auto mt-3 max-w-xl opacity-80">{String(p.subtitle)}</p>
            ) : null}
            <form
              action={String(p.action ?? "")}
              method="post"
              className="mx-auto mt-8 flex w-full max-w-md flex-col gap-2 sm:flex-row"
            >
              <input
                type="email"
                name="email"
                required
                placeholder={String(p.placeholder ?? "nama@email.com")}
                className="flex-1 rounded-[var(--radius)] border bg-background px-4 py-3 text-sm outline-none ring-offset-background transition-colors focus:ring-2"
                style={{ outlineColor: "var(--color-primary)" }}
              />
              <button
                type="submit"
                className="btn-primary px-6 py-3 font-medium shadow-sm transition-transform hover:scale-105"
              >
                {String(p.ctaLabel ?? "Subscribe")}
              </button>
            </form>
            {p.note ? (
              <p className="mt-3 text-xs opacity-60">{String(p.note)}</p>
            ) : null}
          </div>
        </section>
      );

    case "ContactForm":
      return (
        <section className="mx-auto max-w-2xl px-6 py-16">
          <div className="text-center">
            <h3 className="text-3xl font-bold tracking-tight">
              {String(p.title ?? "")}
            </h3>
            {p.subtitle ? (
              <p className="mt-3 opacity-80">{String(p.subtitle)}</p>
            ) : null}
          </div>
          <form
            action={String(p.action ?? "")}
            method="post"
            className="mt-10 space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">Nama</span>
                <input
                  name="name"
                  type="text"
                  required
                  className="mt-1.5 w-full rounded-[var(--radius)] border bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus:ring-2"
                  style={{ outlineColor: "var(--color-primary)" }}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  className="mt-1.5 w-full rounded-[var(--radius)] border bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus:ring-2"
                  style={{ outlineColor: "var(--color-primary)" }}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium">Pesan</span>
              <textarea
                name="message"
                required
                rows={5}
                className="mt-1.5 w-full rounded-[var(--radius)] border bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus:ring-2"
                style={{ outlineColor: "var(--color-primary)" }}
              />
            </label>
            <button
              type="submit"
              className="btn-primary w-full px-6 py-3 font-medium shadow-sm transition-transform hover:scale-[1.02]"
            >
              {String(p.ctaLabel ?? "Kirim")}
            </button>
          </form>
        </section>
      );

    case "Tabs": {
      const items =
        (p.items as Array<{ label: string; body: string }> | undefined) ?? [];
      const tabId = `wb-tabs-${Math.abs(
        hashString(JSON.stringify(items)),
      ).toString(36)}`;
      return (
        <section className="wb-tabs mx-auto max-w-3xl px-6 py-12">
          {items.slice(0, 4).map((_, i) => (
            <input
              key={i}
              type="radio"
              name={tabId}
              id={`${tabId}-${i}`}
              defaultChecked={i === 0}
              className="wb-tab-input"
            />
          ))}
          <div role="tablist" className="flex gap-1 border-b">
            {items.slice(0, 4).map((it, i) => (
              <label
                key={i}
                htmlFor={`${tabId}-${i}`}
                className="wb-tab-label cursor-pointer border-b-2 border-transparent px-4 py-2.5 text-sm font-medium opacity-60 transition-all hover:opacity-100"
              >
                {it.label}
              </label>
            ))}
          </div>
          <div className="wb-tab-panels mt-6">
            {items.slice(0, 4).map((it, i) => (
              <div
                key={i}
                role="tabpanel"
                className="wb-tab-panel whitespace-pre-line text-base leading-relaxed opacity-90"
              >
                {it.body}
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "TestimonialCard": {
      const rating = Number(p.rating ?? 0);
      return (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-3xl border bg-gradient-to-br from-foreground/[0.03] to-transparent p-10">
            {rating > 0 && (
              <div className="mb-4 flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={`text-xl ${i < rating ? "" : "opacity-20"}`}
                    style={{ color: i < rating ? "#fbbf24" : "currentColor" }}
                  >
                    ★
                  </span>
                ))}
              </div>
            )}
            <blockquote className="text-balance text-2xl font-medium leading-snug">
              &ldquo;{String(p.quote ?? "")}&rdquo;
            </blockquote>
            <div className="mt-6 flex items-center gap-4">
              {p.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(p.avatar)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={56}
                  height={56}
                  className="size-14 rounded-full border-2 border-background object-cover shadow-md"
                />
              ) : (
                <div
                  className="grid size-14 place-items-center rounded-full text-lg font-bold text-white shadow-md"
                  style={{ background: "var(--color-primary)" }}
                >
                  {String(p.name ?? "?").charAt(0)}
                </div>
              )}
              <div>
                <div className="font-semibold">{String(p.name ?? "")}</div>
                {p.role ? (
                  <div className="text-sm opacity-70">{String(p.role)}</div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      );
    }

    // ============================================================
    // PRO blocks — markup mirrors editor preview 1:1 so styling
    // (defined in globals.css under .wb-pro-*) renders identically.
    // ============================================================

    case "AuroraHero":
      return (
        <section className="wb-pro-aurora">
          {p.eyebrow ? <div className="wb-pro-eyebrow">{String(p.eyebrow)}</div> : null}
          <h1>{String(p.title ?? "")}</h1>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </section>
      );

    case "SpotlightHero":
      return (
        <section className="wb-pro-spotlight">
          <h1>{String(p.title ?? "")}</h1>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </section>
      );

    case "HighlightHero":
      return (
        <section className="wb-pro-highlight">
          <h1>
            {String(p.title ?? "")}{" "}
            <span className="wb-pro-mark">{String(p.highlight ?? "")}</span>{" "}
            {String(p.titleAfter ?? "")}
          </h1>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </section>
      );

    case "LampHero":
      return (
        <section className="wb-pro-lamp">
          <h1>{String(p.title ?? "")}</h1>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </section>
      );

    case "TypewriterHero":
      return (
        <section className="wb-pro-typewriter">
          <h1>
            {String(p.prefix ?? "")}{" "}
            <span className="wb-pro-typed">{String(p.typed ?? "")}</span>
          </h1>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </section>
      );

    case "GradientTextHero":
      return (
        <section className="wb-pro-gtext">
          {p.eyebrow ? <div className="wb-pro-eyebrow">{String(p.eyebrow)}</div> : null}
          <h1>{String(p.title ?? "")}</h1>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              {String(p.ctaLabel)}
            </a>
          ) : null}
        </section>
      );

    case "BeamsSection":
      return (
        <section className="wb-pro-beams">
          <h2>{String(p.title ?? "")}</h2>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
        </section>
      );

    case "MeteorsSection":
      return (
        <section className="wb-pro-meteors">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="wb-pro-meteor" />
          ))}
          <h2>{String(p.title ?? "")}</h2>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
        </section>
      );

    case "GradientMeshSection":
      return (
        <section className="wb-pro-mesh">
          <span className="wb-pro-mesh-blob" />
          <span className="wb-pro-mesh-blob" />
          <span className="wb-pro-mesh-blob" />
          <h2>{String(p.title ?? "")}</h2>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
        </section>
      );

    case "WavyDivider":
      return (
        <section className="wb-pro-wave">
          <div className="wb-pro-wave-track">
            <svg viewBox="0 0 1200 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M0 30 Q 150 0 300 30 T 600 30 T 900 30 T 1200 30 V60 H0 Z"
                fill="currentColor"
                opacity="0.15"
              />
            </svg>
          </div>
          {p.label ? <div className="wb-pro-wave-label">{String(p.label)}</div> : null}
        </section>
      );

    case "DotPatternSection":
      return (
        <section className="wb-pro-dots">
          <h2>{String(p.title ?? "")}</h2>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
        </section>
      );

    case "GlowCardGrid":
      return (
        <section className="wb-pro-glow-grid">
          {p.title ? <h2>{String(p.title)}</h2> : null}
          <div className="wb-pro-grid">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-glow-card">
                <div className="wb-pro-glow-inner">
                  <h3>{it.title}</h3>
                  <p>{it.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      );

    case "TiltCardGrid":
      return (
        <section className="wb-pro-tilt-grid">
          {p.title ? <h2>{String(p.title)}</h2> : null}
          <div className="wb-pro-grid">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-tilt-card">
                <h3>{it.title}</h3>
                <p>{it.desc}</p>
              </div>
            ))}
          </div>
        </section>
      );

    case "BorderBeamCard":
      return (
        <section className="wb-pro-beam-card">
          <div className="wb-pro-beam-wrap">
            <div className="wb-pro-beam-inner">
              <div style={{ fontSize: "0.7rem", letterSpacing: "0.15em", textTransform: "uppercase", opacity: 0.6 }}>
                {String(p.subtitle ?? "")}
              </div>
              <h3 style={{ marginTop: "0.25rem", fontSize: "1.125rem", fontWeight: 700 }}>
                {String(p.title ?? "")}
              </h3>
              <div className="wb-pro-beam-price">
                {String(p.price ?? "")}
                <span className="wb-pro-beam-period">{String(p.period ?? "")}</span>
              </div>
              <ul>
                {(p.bullets as Array<{ text: string }> | undefined)?.map((b, i) => (
                  <li key={i}>{b.text}</li>
                ))}
              </ul>
              {p.ctaLabel ? (
                <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
                  {String(p.ctaLabel)}
                </a>
              ) : null}
            </div>
          </div>
        </section>
      );

    case "CardStackShowcase":
      return (
        <section className="wb-pro-stack">
          {p.title ? <h2>{String(p.title)}</h2> : null}
          <div className="wb-pro-stack-wrap">
            {(p.items as Array<{ quote: string; name: string; role: string }> | undefined)
              ?.slice(0, 3)
              .map((it, i) => (
                <div key={i} className="wb-pro-stack-card">
                  <blockquote>&ldquo;{it.quote}&rdquo;</blockquote>
                  <div className="wb-pro-stack-meta">
                    <div className="wb-pro-stack-name">{it.name}</div>
                    <div className="wb-pro-stack-role">{it.role}</div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      );

    case "HoverGlowGrid":
      return (
        <section className="wb-pro-hover-grid">
          {p.title ? <h2>{String(p.title)}</h2> : null}
          <div className="wb-pro-grid">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-hover-card">
                <h3>{it.title}</h3>
                <p>{it.desc}</p>
              </div>
            ))}
          </div>
        </section>
      );

    case "AnimatedCounterStats":
      return (
        <section className="wb-pro-counters">
          {p.title ? <h2>{String(p.title)}</h2> : null}
          <div className="wb-pro-grid">
            {(p.items as Array<{ value: string; label: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-counter-cell">
                <div className="wb-pro-counter-value" style={{ animationDelay: `${i * 0.15}s` }}>
                  {it.value}
                </div>
                <div className="wb-pro-counter-label">{it.label}</div>
              </div>
            ))}
          </div>
        </section>
      );

    case "MovingBorderCTA":
      return (
        <section className="wb-pro-mb-cta">
          <h2>{String(p.title ?? "")}</h2>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          {p.ctaLabel ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-mb-btn">
              <span className="wb-pro-mb-inner">{String(p.ctaLabel)}</span>
            </a>
          ) : null}
        </section>
      );

    case "InfiniteMarqueeLogos": {
      const top = (p.itemsTop as Array<{ name: string }> | undefined) ?? [];
      const bottom = (p.itemsBottom as Array<{ name: string }> | undefined) ?? [];
      return (
        <section className="wb-pro-marquee">
          {p.title ? <h2>{String(p.title)}</h2> : null}
          <div className="wb-pro-marquee-row">
            {[...top, ...top].map((it, i) => (
              <span key={"t" + i}>{it.name}</span>
            ))}
          </div>
          <div className="wb-pro-marquee-row">
            {[...bottom, ...bottom].map((it, i) => (
              <span key={"b" + i}>{it.name}</span>
            ))}
          </div>
        </section>
      );
    }

    case "OrbitFeatures": {
      const items = (p.items as Array<{ icon: string; label: string }> | undefined) ?? [];
      return (
        <section className="wb-pro-orbit">
          <h2>{String(p.title ?? "")}</h2>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          <div className="wb-pro-orbit-stage">
            <div className="wb-pro-orbit-center">{String(p.brand ?? "B")}</div>
            <div className="wb-pro-orbit-ring">
              {items.map((it, i) => {
                const angle = (360 / Math.max(items.length, 1)) * i;
                return (
                  <div
                    key={i}
                    className="wb-pro-orbit-item"
                    style={{
                      transform: `rotate(${angle}deg) translateY(-160px) rotate(${-angle}deg)`,
                    }}
                  >
                    <span>{it.icon}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    // Data-backed blocks are dispatched by BlockNode and never reach here.
    case "UmkmCatalogDynamic":
      return null;

    // Umkm* blocks render via the shared module; unknown types (incl. retired
    // Guru* blocks in old published trees) fall through to null.
    default:
      return renderUmkmBlock(block.type, block.props, liveUmkmCtx);
  }
}

// ---------- Helpers ----------

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  }
  return h;
}

// Inline SVG icons for SocialLinks (kept small/static so we don't pull lucide into renderer).
function socialIcon(platform: string): string {
  const norm = platform.toLowerCase();
  const wrap = (path: string) =>
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${path}</svg>`;
  if (norm.includes("instagram"))
    return wrap(
      `<path d="M7 2C4.243 2 2 4.243 2 7v10c0 2.757 2.243 5 5 5h10c2.757 0 5-2.243 5-5V7c0-2.757-2.243-5-5-5H7zm0 2h10c1.654 0 3 1.346 3 3v10c0 1.654-1.346 3-3 3H7c-1.654 0-3-1.346-3-3V7c0-1.654 1.346-3 3-3zm10 1a1 1 0 100 2 1 1 0 000-2zm-5 2a5 5 0 100 10 5 5 0 000-10zm0 2a3 3 0 110 6 3 3 0 010-6z"/>`,
    );
  if (norm.includes("twitter") || norm.includes("x.com") || norm === "x")
    return wrap(
      `<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>`,
    );
  if (norm.includes("facebook"))
    return wrap(
      `<path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 4.99 3.66 9.13 8.44 9.88v-6.99H7.9v-2.89h2.54v-2.2c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.19 2.24.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.45 2.89h-2.33V22c4.78-.75 8.44-4.89 8.44-9.94z"/>`,
    );
  if (norm.includes("linkedin"))
    return wrap(
      `<path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.59 0 4.26 2.36 4.26 5.43v6.31zM5.34 7.43a2.06 2.06 0 11-.01-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.55V9h3.57v11.45z"/>`,
    );
  if (norm.includes("youtube"))
    return wrap(
      `<path d="M23.5 6.51a3 3 0 00-2.12-2.12C19.66 4 12 4 12 4s-7.66 0-9.38.4A3 3 0 00.5 6.5C.1 8.22.1 12 .1 12s0 3.78.4 5.5a3 3 0 002.12 2.12C4.34 20 12 20 12 20s7.66 0 9.38-.4a3 3 0 002.12-2.12c.4-1.72.4-5.5.4-5.5s0-3.78-.4-5.5zM9.6 15.5v-7l6.4 3.5-6.4 3.5z"/>`,
    );
  if (norm.includes("tiktok"))
    return wrap(
      `<path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005.9 20.84a6.32 6.32 0 0010.86-4.43V7.94a8.16 8.16 0 004.77 1.52V6a4.82 4.82 0 01-1.94-.31z"/>`,
    );
  if (norm.includes("github"))
    return wrap(
      `<path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.6 11.6 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1 .8 2.1v3.2c0 .3.2.7.8.6A12 12 0 0012 .3"/>`,
    );
  if (norm.includes("email") || norm.includes("mail"))
    return wrap(
      `<path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"/>`,
    );
  if (norm.includes("whatsapp") || norm.includes("wa"))
    return wrap(
      `<path d="M.06 24l1.68-6.13A11.86 11.86 0 010 12.01C0 5.4 5.4 0 12.01 0 18.62 0 24 5.4 24 12.01 24 18.62 18.6 24 12.01 24c-2 0-3.95-.5-5.66-1.45L.06 24zm6.6-3.81c1.66.99 3.27 1.58 5.34 1.58 5.5 0 9.97-4.47 9.97-9.97S17.5 1.84 12 1.84 2.03 6.31 2.03 11.81c0 2.17.64 3.78 1.71 5.49l-1 3.66 3.92-1.03z"/>`,
    );
  // generic fallback
  return wrap(
    `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  );
}

// --- Dynamic blocks: fetch live data from API ---

async function ProductGridDynamic({ block, siteId }: { block: Block; siteId: string }) {
  const p = block.props ?? {};
  const limit = Number(p.limit ?? 12);
  const products = await listProducts(siteId, limit);
  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      {p.title ? <h3 className="mb-6 text-2xl font-semibold">{String(p.title)}</h3> : null}
      {products.length === 0 ? (
        <p className="opacity-70">Belum ada produk.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((pr) => (
            <a
              key={pr.id}
              href={`/produk/${pr.slug}`}
              className="overflow-hidden rounded-xl border transition hover:shadow-md"
            >
              {pr.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pr.image_url}
                  alt={pr.name}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="aspect-square bg-slate-100" />
              )}
              <div className="p-4">
                <div className="font-medium">{pr.name}</div>
                <div className="mt-1 text-sm opacity-80">{formatPrice(pr.price, pr.currency)}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// UmkmCatalogDynamic — product cards from the Produk tab. The public API has no
// category/stock filters, so over-fetch then filter here.
async function UmkmCatalogDynamic({ block, siteId }: { block: Block; siteId: string }) {
  const p = block.props ?? {};
  const limit = Math.min(48, Math.max(1, Number(p.limit ?? 8) || 8));
  if (siteId.startsWith("_template")) {
    // Template previews have no products; samples + note keep the page looking finished.
    return renderUmkmBlock(block.type, p, liveUmkmCtx, {
      cards: UMKM_SAMPLE_PRODUCTS.slice(0, limit),
      note: "Contoh tampilan — produk asli diambil otomatis dari tab Produk.",
    });
  }
  const category = String(p.category ?? "").trim().toLowerCase();
  const showSoldOut = p.showOutOfStock === "yes";
  const products = await listProducts(siteId, category || !showSoldOut ? 100 : limit);
  const cards: UmkmCard[] = products
    .filter((pr) => !category || (pr.category ?? "").trim().toLowerCase() === category)
    .filter((pr) => showSoldOut || pr.stock == null || pr.stock > 0)
    .slice(0, limit)
    .map((pr) => {
      const soldOut = pr.stock != null && pr.stock <= 0;
      return {
        name: pr.name,
        image: pr.image_url,
        price: !pr.currency || pr.currency === "IDR" ? formatRupiah(pr.price) : formatPrice(pr.price, pr.currency),
        originalPrice: "",
        badge: soldOut ? "habis" : "",
        desc: (pr.description ?? "").replace(/[#*_`>\[\]]/g, "").slice(0, 160),
        href: `/produk/${pr.slug}`,
        soldOut,
      };
    });
  return renderUmkmBlock(block.type, p, liveUmkmCtx, { cards });
}

// FormBlockAsync — server component yang fetch definisi form (fields, kind)
// via /public/forms/:id, lalu render FormBlock client component untuk submit
// handling. Kalau formId kosong (belum di-set di editor) atau form deleted,
// render placeholder helpful supaya owner tahu apa yang perlu difix.
async function FormBlockAsync({ block }: { block: Block }) {
  const p = block.props ?? {};
  const formId = String(p.formId ?? "");
  if (!formId) {
    return (
      <section className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-xl border border-dashed p-6 text-center text-sm opacity-70">
          Form belum dipilih. Buka editor → block Form → tempel Form ID dari tab Form.
        </div>
      </section>
    );
  }
  const form = await getPublicForm(formId);
  if (!form || !form.fields || form.fields.length === 0) {
    return (
      <section className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-xl border border-dashed p-6 text-center text-sm opacity-70">
          Form tidak ditemukan atau belum ada field. Periksa Form ID di editor.
        </div>
      </section>
    );
  }
  return (
    <FormBlock
      formId={form.id}
      fields={form.fields}
      title={p.title ? String(p.title) : undefined}
      subtitle={p.subtitle ? String(p.subtitle) : undefined}
      submitLabel={p.submitLabel ? String(p.submitLabel) : undefined}
      successMessage={p.successMessage ? String(p.successMessage) : undefined}
    />
  );
}

async function BlogListDynamicAsync({ block, siteId }: { block: Block; siteId: string }) {
  const p = block.props ?? {};
  const limit = Number(p.limit ?? 10);
  const posts = await listBlogPosts(siteId, limit);
  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      {p.title ? <h3 className="mb-6 text-2xl font-semibold">{String(p.title)}</h3> : null}
      {posts.length === 0 ? (
        <p className="opacity-70">Belum ada artikel.</p>
      ) : (
        posts.map((post) => (
          <a
            key={post.id}
            href={`/blog/${post.slug}`}
            className="mb-6 block border-b pb-6 last:border-0"
          >
            {post.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.cover_image_url}
                alt={post.title}
                loading="lazy"
                decoding="async"
                className="mb-3 aspect-[3/1] w-full rounded-lg object-cover"
              />
            ) : null}
            <h3 className="text-xl font-semibold">{post.title}</h3>
            <p className="mt-1 opacity-80">{post.excerpt}</p>
            {post.published_at && (
              <p className="mt-1 text-xs opacity-60">
                {new Date(post.published_at).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            )}
          </a>
        ))
      )}
    </section>
  );
}

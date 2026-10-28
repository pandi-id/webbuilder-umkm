import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { formatPrice, getProduct, getSiteByHost } from "@/lib/api";
import { googleFontsUrl, themeToCss } from "@/lib/theme";
import { buildProduct, wrap } from "@/lib/schema";
import { PageViewBeacon } from "@/components/PageViewBeacon";
import { SiteBodyEndCode, SiteHeadCode } from "@/components/CustomCode";
import { SiteCart } from "@/components/cart/SiteCart";
import { ProductPurchase } from "@/components/cart/ProductPurchase";

export const dynamic = "force-dynamic";

async function host() {
  return ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
}

export default async function ProductDetail(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const site = await getSiteByHost(await host());
  if (!site) notFound();
  const product = await getProduct(site.id, params.slug);
  if (!product) notFound();

  const fontHref = googleFontsUrl(site.theme);
  const gallery = Array.isArray(product.gallery) ? product.gallery : [];
  const baseURL = `https://${await host()}`;
  const productLD = wrap([buildProduct(product, baseURL)]);

  return (
    <SiteCart siteId={site.id}>
      <style dangerouslySetInnerHTML={{ __html: themeToCss(site.theme) }} />
      {fontHref ? <link rel="stylesheet" href={fontHref} /> : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: productLD }} />
      <SiteHeadCode site={site} />
      <PageViewBeacon siteId={site.id} pageSlug={`/produk/${params.slug}`} />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <nav className="mb-6 text-sm opacity-70">
          <a href="/" className="hover:underline">
            ← Beranda
          </a>
        </nav>

        <div className="grid gap-8 md:grid-cols-2">
          <div>
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image_url}
                alt={product.name}
                fetchPriority="high"
                decoding="async"
                className="aspect-square w-full rounded-xl border object-cover"
              />
            ) : (
              <div className="aspect-square w-full rounded-xl border bg-slate-100" />
            )}
            {gallery.length > 0 && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {gallery.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full rounded border object-cover"
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            {product.category && (
              <p className="text-sm uppercase tracking-wide opacity-60">{product.category}</p>
            )}
            <h1 className="mt-1 text-3xl font-bold">{product.name}</h1>
            <p className="mt-4 text-3xl font-semibold" style={{ color: "var(--color-primary)" }}>
              {formatPrice(product.price, product.currency)}
            </p>

            {product.stock !== null && (
              <p className="mt-2 text-sm opacity-70">
                {product.stock > 0 ? `Stok: ${product.stock}` : "Stok habis"}
              </p>
            )}

            <ProductPurchase
              slug={product.slug}
              name={product.name}
              price={product.price}
              image={product.image_url}
              stock={product.stock}
            />

            {product.description && (
              <div className="mt-6 whitespace-pre-line opacity-90">{product.description}</div>
            )}
          </div>
        </div>
      </main>
      <SiteBodyEndCode site={site} />
    </SiteCart>
  );
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const site = await getSiteByHost(await host());
  if (!site) return {};
  const product = await getProduct(site.id, params.slug);
  if (!product) return {};
  return {
    title: `${product.name} — ${site.name}`,
    description:
      product.description.slice(0, 160) || `${product.name} ${formatPrice(product.price, product.currency)}`,
  };
}

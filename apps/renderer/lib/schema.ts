// Schema.org JSON-LD builder — inject di setiap page renderer supaya search
// engine + AI crawler bisa parse content structured. Google Rich Results
// pakai ini untuk featured snippet (Article, Product, LocalBusiness).
//
// Convention: satu <script type="application/ld+json"> per page dengan
// `@graph` array kalau > 1 entity — best practice per Google docs.

import type { BlogPost, Product, Site } from "./api";

type Thing = Record<string, unknown>;

// buildWebSite = root schema untuk homepage. Search box hint kalau site
// punya /search (kita belum punya, jadi omit untuk sekarang).
export function buildWebSite(site: Site, baseURL: string): Thing {
  return {
    "@type": "WebSite",
    name: site.name,
    url: baseURL,
    inLanguage: "id-ID",
  };
}

// buildOrganization = identity site sebagai organisasi. Tanpa logo detail,
// minimal name + URL. Kalau nanti site.logo_url ada, tambah di sini.
export function buildOrganization(site: Site, baseURL: string): Thing {
  return {
    "@type": "Organization",
    name: site.name,
    url: baseURL,
  };
}

// buildArticle untuk blog post — mirror BlogPosting schema Google.
// datePublished + author yang paling penting untuk Rich Results.
export function buildArticle(post: BlogPost, site: Site, baseURL: string): Thing {
  const item: Thing = {
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt || undefined,
    author: post.author_name
      ? { "@type": "Person", name: post.author_name }
      : { "@type": "Organization", name: site.name },
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: baseURL,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${baseURL}/blog/${post.slug}`,
    },
    inLanguage: "id-ID",
  };
  if (post.cover_image_url) item.image = post.cover_image_url;
  if (post.published_at) item.datePublished = post.published_at;
  if (post.tags && post.tags.length > 0) item.keywords = post.tags.join(", ");
  return item;
}

// buildProduct — Google Merchant + Rich Results eligible. Butuh: name, image,
// description, offers (price + currency + availability).
export function buildProduct(product: Product, baseURL: string): Thing {
  const item: Thing = {
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    url: `${baseURL}/produk/${product.slug}`,
    offers: {
      "@type": "Offer",
      price: product.price.toString(),
      priceCurrency: product.currency,
      availability:
        product.stock == null || product.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      url: `${baseURL}/produk/${product.slug}`,
    },
  };
  if (product.image_url) item.image = product.image_url;
  if (product.category) item.category = product.category;
  return item;
}

// wrap = envelope JSON-LD dengan @context. Kalau multi-entity, pakai @graph.
export function wrap(things: Thing[]): string {
  const doc =
    things.length === 1
      ? { "@context": "https://schema.org", ...things[0] }
      : { "@context": "https://schema.org", "@graph": things };
  return JSON.stringify(doc);
}

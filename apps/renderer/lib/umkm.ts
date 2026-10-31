// UMKM block helpers. This file is byte-identical in apps/web/lib/umkm.ts and
// apps/renderer/lib/umkm.ts; the Go port lives in apps/api/internal/exports/render_umkm.go.

// normalizeWaNumber turns local formats ("0812-3456 789", "+62 812…") into the
// digits-only international form wa.me expects.
export function normalizeWaNumber(raw: string): string {
  let n = String(raw ?? "").replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  else if (n.startsWith("8")) n = "62" + n;
  return n;
}

// waLink: no number still yields a working link (WhatsApp opens the contact picker).
export function waLink(number: string, message?: string): string {
  const n = normalizeWaNumber(number);
  const text = String(message ?? "").trim();
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

// formatRupiah avoids toLocaleString so server, browser and Go output match exactly.
export function formatRupiah(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}Rp ${s}`;
}

// parsePrice reads "Rp 25.000", "25000", "Rp25.000,00" → 25000. Null when no digits.
export function parsePrice(raw: string): number | null {
  const s = String(raw ?? "").replace(/,\d{1,2}\s*$/, "");
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

// displayPrice formats bare numbers ("25000") as Rupiah, keeps free text as typed.
export function displayPrice(raw: string): string {
  const s = String(raw ?? "").trim();
  return /^\d+$/.test(s) ? formatRupiah(Number(s)) : s;
}

export function discountPercent(price: string, original: string): number | null {
  const now = parsePrice(price);
  const was = parsePrice(original);
  if (now == null || was == null || was <= 0 || now >= was) return null;
  const pct = Math.round(((was - now) / was) * 100);
  return pct > 0 ? pct : null;
}

// safeHref blocks javascript:/data: URLs from user-entered links.
export function safeHref(raw: string, fallback = "#"): string {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  if (/^(https?:|mailto:|tel:|\/|#|\?)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return fallback;
  return s;
}

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

// Only Google Maps embeds — matches the renderer CSP frame-src (www.google.com).
export function mapEmbedSrc(src: string, address: string): string {
  const s = String(src ?? "").trim();
  if (s) {
    return /^https:\/\/www\.google\.com\/maps(\/embed)?[/?]/i.test(s) ? s : "";
  }
  const a = String(address ?? "").trim();
  return a ? `https://www.google.com/maps?q=${encodeURIComponent(a)}&output=embed` : "";
}

export function mapDirectionsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(address ?? "").trim())}`;
}

export function telHref(phone: string): string {
  const s = String(phone ?? "").trim();
  return `tel:${s.startsWith("+") ? "+" : ""}${s.replace(/\D/g, "")}`;
}

export function initialOf(name: string): string {
  const s = String(name ?? "").trim();
  return s ? s[0].toUpperCase() : "?";
}

export function clampRating(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 5;
  return Math.min(5, Math.max(1, n));
}

export const UMKM_BADGES: Record<string, string> = {
  terlaris: "Terlaris",
  baru: "Baru",
  promo: "Promo",
  habis: "Habis",
};

// Third-party brand accents are allowed as tiny dots; "website" follows the theme.
export const UMKM_PLATFORMS: Record<string, { label: string; color: string; short: string }> = {
  shopee: { label: "Shopee", color: "#EE4D2D", short: "S" },
  tokopedia: { label: "Tokopedia", color: "#03AC0E", short: "T" },
  tiktokshop: { label: "TikTok Shop", color: "#111111", short: "TT" },
  lazada: { label: "Lazada", color: "#0F146D", short: "L" },
  gofood: { label: "GoFood", color: "#EE2737", short: "GF" },
  grabfood: { label: "GrabFood", color: "#00B14F", short: "G" },
  shopeefood: { label: "ShopeeFood", color: "#EE4D2D", short: "SF" },
  instagram: { label: "Instagram", color: "#E1306C", short: "IG" },
  facebook: { label: "Facebook", color: "#1877F2", short: "f" },
  website: { label: "Website", color: "var(--color-primary)", short: "W" },
};

// Inner SVG markup (24×24, stroke icons). Static strings — safe for innerHTML.
export const UMKM_ICONS: Record<string, string> = {
  halal: `<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>`,
  pirt: `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>`,
  bpom: `<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12A2 2 0 0 1 14 9.53V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>`,
  sni: `<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>`,
  qris: `<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>`,
  cod: `<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>`,
  transfer: `<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>`,
  delivery: `<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>`,
  guarantee: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`,
  handmade: `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>`,
  pin: `<path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
  phone: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  mail: `<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`,
  check: `<path d="M20 6 9 17l-5-5"/>`,
  tag: `<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>`,
  image: `<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>`,
  arrow: `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  external: `<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`,
};

// Filled glyphs (fill="currentColor").
export const UMKM_WA_PATH = `<path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.89-9.88 9.89m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41Z"/>`;
export const UMKM_STAR_PATH = `<path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z"/>`;

export type UmkmCard = {
  name: string;
  image: string;
  price: string;
  originalPrice: string;
  badge: string;
  desc: string;
  href: string;
  soldOut: boolean;
  // Set only for DB products (catalogCards): lets the live site add the card to a cart.
  slug?: string;
  amount?: number;
};

// Product fields shared by the public API (renderer) and the dashboard API (editor).
export type CatalogProduct = {
  name: string;
  slug: string;
  image_url: string;
  price: number;
  currency?: string;
  stock?: number | null;
  category?: string;
  description?: string;
  status?: string;
};

// plainExcerpt flattens a Markdown description (the product editor writes
// Markdown) into one line of prose for card blurbs and meta tags. Deliberately
// lossy: links keep their label, images and formatting markers disappear.
export function plainExcerpt(md: string, max: number): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")       // fenced code (incl. youtube/audio)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
    .replace(/^\s{0,3}>\s?/gm, "")          // blockquote markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")     // headings
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "") // list bullets
    .replace(/[*_`~]/g, "")                // emphasis + inline code
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

export function catalogLimit(props: Record<string, unknown>): number {
  return Math.min(48, Math.max(1, Number(props.limit ?? 8) || 8));
}

// catalogCards applies UmkmCatalogDynamic's filters (status, category, sold-out,
// limit) so the editor canvas and the live site list exactly the same products.
export function catalogCards(
  products: CatalogProduct[],
  props: Record<string, unknown>,
  formatPrice: (amount: number, currency: string) => string = (amount) => formatRupiah(amount),
): UmkmCard[] {
  const category = String(props.category ?? "").trim().toLowerCase();
  const showSoldOut = props.showOutOfStock === "yes";
  return products
    .filter((pr) => !pr.status || pr.status === "active")
    .filter((pr) => !category || (pr.category ?? "").trim().toLowerCase() === category)
    .filter((pr) => showSoldOut || pr.stock == null || pr.stock > 0)
    .slice(0, catalogLimit(props))
    .map((pr) => {
      const soldOut = pr.stock != null && pr.stock <= 0;
      const currency = pr.currency || "IDR";
      return {
        name: pr.name,
        image: pr.image_url,
        price: currency === "IDR" ? formatRupiah(pr.price) : formatPrice(pr.price, currency),
        originalPrice: "",
        badge: soldOut ? "habis" : "",
        desc: plainExcerpt(pr.description ?? "", 160),
        href: `/produk/${pr.slug}`,
        soldOut,
        slug: pr.slug,
        amount: pr.price,
      };
    });
}

// Shown in the editor canvas and template previews where no DB products exist.
export const UMKM_SAMPLE_PRODUCTS: UmkmCard[] = [
  { name: "Kopi Susu Gula Aren", image: "", price: "Rp 22.000", originalPrice: "Rp 28.000", badge: "terlaris", desc: "Espresso, susu segar, dan gula aren asli Garut.", href: "", soldOut: false },
  { name: "Es Kopi Pandan", image: "", price: "Rp 25.000", originalPrice: "", badge: "baru", desc: "Kopi susu dengan sirup pandan wangi buatan sendiri.", href: "", soldOut: false },
  { name: "Roti Bakar Cokelat Keju", image: "", price: "Rp 18.000", originalPrice: "", badge: "", desc: "Roti tebal, selai cokelat, dan keju parut melimpah.", href: "", soldOut: false },
  { name: "Kopi Literan 1 Liter", image: "", price: "Rp 85.000", originalPrice: "Rp 95.000", badge: "promo", desc: "Cukup untuk 6–8 gelas, tahan 3 hari di kulkas.", href: "", soldOut: false },
];

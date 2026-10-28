// UMKM block markup shared by the live renderer and the editor canvas. This file
// is byte-identical in apps/web/components/umkm/ and apps/renderer/components/umkm/;
// text goes through ctx.text so the editor can swap in inline editing without
// forking the markup. The Go exporter (render_umkm.go) mirrors the same classes.
import { createElement, type ReactNode } from "react";
import "./umkm.css";
import {
  UMKM_BADGES,
  UMKM_ICONS,
  UMKM_PLATFORMS,
  UMKM_STAR_PATH,
  UMKM_WA_PATH,
  clampRating,
  discountPercent,
  displayPrice,
  initialOf,
  isExternalHref,
  mapDirectionsHref,
  mapEmbedSrc,
  safeHref,
  telHref,
  waLink,
  type UmkmCard,
} from "@/lib/umkm";
import { UmkmCopyCode } from "./UmkmCopyCode";

export type UmkmTag = "h1" | "h2" | "h3" | "p" | "span" | "div";

export type UmkmTextOpts = {
  as: UmkmTag;
  value: string;
  // Prop path: ["title"], ["items", 2, "name"] or ["chips", 1] for string lists.
  path: Array<string | number>;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
};

export type UmkmCtx = {
  // live: real links + fixed float. False in the editor canvas.
  live: boolean;
  // editable: render empty optional fields so they can be filled inline.
  editable: boolean;
  text: (o: UmkmTextOpts) => ReactNode;
  // Renderer-only: replaces the WhatsApp CTA on cards that carry a product slug.
  // Optional so the editor and static export keep the plain WhatsApp button.
  cartButton?: (card: UmkmCard) => ReactNode;
};

export const liveUmkmCtx: UmkmCtx = {
  live: true,
  editable: false,
  text: ({ as, value, className }) => (value ? createElement(as, { className }, value) : null),
};

export const UMKM_BLOCK_TYPES = new Set([
  "UmkmHero",
  "UmkmProductShowcase",
  "UmkmCatalogDynamic",
  "UmkmPromoBanner",
  "UmkmStoreInfo",
  "UmkmMarketplaceLinks",
  "UmkmTrustBadges",
  "UmkmReviews",
  "UmkmWhatsAppFloat",
]);

type Props = Record<string, unknown>;
type Item = Record<string, unknown>;

function s(p: Props | undefined, k: string): string {
  const v = p?.[k];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}
function list(p: Props, k: string): Item[] {
  const v = p[k];
  return Array.isArray(v) ? v.filter((x): x is Item => !!x && typeof x === "object") : [];
}
function strs(p: Props, k: string): string[] {
  const v = p[k];
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")) : [];
}
function anchor(p: Props): string | undefined {
  const id = s(p, "anchorId").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return id || undefined;
}
function show(ctx: UmkmCtx, v: string): boolean {
  return ctx.editable || v.trim() !== "";
}
function linkAttrs(ctx: UmkmCtx, href: string) {
  if (!ctx.live) return {};
  const h = safeHref(href);
  return isExternalHref(h) ? { href: h, target: "_blank", rel: "noopener noreferrer" } : { href: h };
}

function Icon({ name, small }: { name: string; small?: boolean }) {
  return (
    <svg
      className={small ? "wb-umkm-ic wb-umkm-ic--sm" : "wb-umkm-ic"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: UMKM_ICONS[name] ?? UMKM_ICONS.check }}
    />
  );
}

function WaIcon() {
  return (
    <svg
      className="wb-umkm-ic"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: UMKM_WA_PATH }}
    />
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="wb-umkm-stars" role="img" aria-label={`${rating} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          className={i <= rating ? "wb-umkm-star" : "wb-umkm-star is-off"}
          viewBox="0 0 24 24"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: UMKM_STAR_PATH }}
        />
      ))}
    </span>
  );
}

function Head({ ctx, p, left }: { ctx: UmkmCtx; p: Props; left?: boolean }) {
  const title = s(p, "title");
  const subtitle = s(p, "subtitle");
  if (!show(ctx, title) && !show(ctx, subtitle)) return null;
  return (
    <header className={left ? "wb-umkm-head wb-umkm-head--left" : "wb-umkm-head"}>
      {show(ctx, title) &&
        ctx.text({ as: "h2", className: "wb-umkm-title", value: title, path: ["title"], placeholder: "Judul section…" })}
      {show(ctx, subtitle) &&
        ctx.text({ as: "p", className: "wb-umkm-sub", value: subtitle, path: ["subtitle"], placeholder: "Subjudul (opsional)…", multiline: true })}
    </header>
  );
}

// ------------------------------- UmkmHero -------------------------------

function Hero({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  const eyebrow = s(p, "eyebrow");
  const title = s(p, "title");
  const subtitle = s(p, "subtitle");
  const ctaLabel = s(p, "ctaLabel");
  const cta2 = s(p, "ctaSecondaryLabel");
  const rating = s(p, "rating");
  const image = s(p, "image");
  const chips = strs(p, "chips").slice(0, 3);
  const stars = clampRating(Number.parseFloat(rating.replace(",", ".")) || 5);
  return (
    <section className="wb-umkm wb-umkm-hero">
      <div className="wb-umkm-wrap wb-umkm-hero-grid">
        <div className="wb-umkm-hero-copy">
          {show(ctx, eyebrow) && (
            <span className="wb-umkm-eyebrow">
              <span className="wb-umkm-eyebrow-dot" aria-hidden="true" />
              {ctx.text({ as: "span", value: eyebrow, path: ["eyebrow"], placeholder: "Info singkat…" })}
            </span>
          )}
          {ctx.text({ as: "h1", className: "wb-umkm-hero-title", value: title, path: ["title"], placeholder: "Judul utama toko…" })}
          {show(ctx, subtitle) &&
            ctx.text({ as: "p", className: "wb-umkm-hero-sub", value: subtitle, path: ["subtitle"], placeholder: "Deskripsi singkat…", multiline: true })}
          {(show(ctx, ctaLabel) || show(ctx, cta2)) && (
            <div className="wb-umkm-actions">
              {show(ctx, ctaLabel) && (
                <a
                  className="wb-umkm-btn wb-umkm-btn--primary wb-umkm-btn--lg"
                  {...linkAttrs(ctx, waLink(s(p, "waNumber"), s(p, "waMessage")))}
                >
                  <WaIcon />
                  {ctx.text({ as: "span", value: ctaLabel, path: ["ctaLabel"], placeholder: "Label tombol…" })}
                </a>
              )}
              {show(ctx, cta2) && (
                <a className="wb-umkm-btn wb-umkm-btn--ghost wb-umkm-btn--lg" {...linkAttrs(ctx, s(p, "ctaSecondaryHref"))}>
                  {ctx.text({ as: "span", value: cta2, path: ["ctaSecondaryLabel"], placeholder: "Tombol kedua…" })}
                </a>
              )}
            </div>
          )}
          {chips.some((c) => show(ctx, c)) && (
            <ul className="wb-umkm-chips">
              {chips.map((c, i) =>
                show(ctx, c) ? (
                  <li key={i} className="wb-umkm-chip">
                    <Icon name="check" small />
                    {ctx.text({ as: "span", value: c, path: ["chips", i], placeholder: "Keunggulan…" })}
                  </li>
                ) : null,
              )}
            </ul>
          )}
          {show(ctx, rating) && (
            <div className="wb-umkm-rating">
              <Stars rating={stars} />
              {ctx.text({ as: "span", value: rating, path: ["rating"], placeholder: "4.9 dari 1.000+ pembeli" })}
            </div>
          )}
        </div>
        <div className="wb-umkm-hero-media">
          <div className="wb-umkm-hero-frame">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt={title} />
            ) : (
              <div className="wb-umkm-ph">
                <Icon name="image" />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------- Product cards -----------------------------

function ProductCard({
  ctx,
  card,
  waNumber,
  buttonLabel,
  idx,
}: {
  ctx: UmkmCtx;
  card: UmkmCard;
  waNumber: string;
  buttonLabel: string;
  // idx set → card comes from props.items and is inline-editable.
  idx?: number;
}) {
  const editable = idx !== undefined;
  const soldOut = card.soldOut || card.badge === "habis";
  const badgeLabel = UMKM_BADGES[card.badge] ?? "";
  const disc = soldOut ? null : discountPercent(card.price, card.originalPrice);
  const txt = (as: UmkmTag, field: string, value: string, className: string, placeholder: string) =>
    editable
      ? ctx.text({ as, className, value, path: ["items", idx ?? 0, field], placeholder })
      : value
        ? createElement(as, { className }, value)
        : null;
  return (
    <article className={soldOut ? "wb-umkm-card is-soldout" : "wb-umkm-card"}>
      <div className="wb-umkm-card-media">
        {card.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.image} alt={card.name} loading="lazy" decoding="async" />
        ) : (
          <div className="wb-umkm-ph">
            <Icon name="image" />
          </div>
        )}
        {badgeLabel ? <span className={`wb-umkm-badge wb-umkm-badge--${card.badge}`}>{badgeLabel}</span> : null}
        {disc ? <span className="wb-umkm-disc">-{disc}%</span> : null}
      </div>
      <div className="wb-umkm-card-body">
        {card.href && ctx.live ? (
          <h3 className="wb-umkm-card-name">
            <a href={safeHref(card.href)}>{card.name}</a>
          </h3>
        ) : (
          txt("h3", "name", card.name, "wb-umkm-card-name", "Nama produk…")
        )}
        {(card.desc || (editable && ctx.editable)) && txt("p", "desc", card.desc, "wb-umkm-card-desc", "Deskripsi singkat…")}
        <div className="wb-umkm-price">
          {txt("span", "price", displayPrice(card.price), "wb-umkm-price-now", "Rp 0")}
          {card.originalPrice ? txt("span", "originalPrice", displayPrice(card.originalPrice), "wb-umkm-price-was", "") : null}
        </div>
        {soldOut ? (
          <span className="wb-umkm-btn wb-umkm-btn--sm wb-umkm-btn--block wb-umkm-card-cta is-disabled">Stok habis</span>
        ) : ctx.cartButton && card.slug ? (
          ctx.cartButton(card)
        ) : (
          <a
            className="wb-umkm-btn wb-umkm-btn--primary wb-umkm-btn--sm wb-umkm-btn--block wb-umkm-card-cta"
            aria-label={`${buttonLabel} ${card.name} via WhatsApp`}
            {...linkAttrs(ctx, waLink(waNumber, `Halo, saya mau pesan ${card.name}`))}
          >
            <WaIcon />
            <span>{buttonLabel}</span>
          </a>
        )}
      </div>
    </article>
  );
}

function gridClass(p: Props): string {
  return s(p, "columns") === "3" ? "wb-umkm-grid" : "wb-umkm-grid wb-umkm-grid--4";
}

function itemToCard(it: Item): UmkmCard {
  return {
    name: s(it, "name"),
    image: s(it, "image"),
    price: s(it, "price"),
    originalPrice: s(it, "originalPrice"),
    badge: s(it, "badge"),
    desc: s(it, "desc"),
    href: "",
    soldOut: s(it, "badge") === "habis",
  };
}

function Showcase({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  const waNumber = s(p, "waNumber");
  const buttonLabel = s(p, "buttonLabel") || "Pesan";
  return (
    <section className="wb-umkm wb-umkm-showcase" id={anchor(p)}>
      <div className="wb-umkm-wrap">
        <Head ctx={ctx} p={p} />
        <div className={gridClass(p)}>
          {list(p, "items").map((it, i) => (
            <ProductCard key={i} ctx={ctx} card={itemToCard(it)} waNumber={waNumber} buttonLabel={buttonLabel} idx={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function UmkmCatalogView({
  ctx,
  p,
  cards,
  note,
}: {
  ctx: UmkmCtx;
  p: Props;
  cards: UmkmCard[];
  note?: string;
}) {
  const waNumber = s(p, "waNumber");
  const buttonLabel = s(p, "buttonLabel") || "Pesan";
  return (
    <section className="wb-umkm wb-umkm-catalog" id={anchor(p)}>
      <div className="wb-umkm-wrap">
        <Head ctx={ctx} p={p} />
        {note ? <p className="wb-umkm-note">{note}</p> : null}
        {cards.length === 0 ? (
          <p className="wb-umkm-empty">Produk segera hadir. Hubungi kami untuk info stok terbaru.</p>
        ) : (
          <div className={gridClass(p)}>
            {cards.map((c, i) => (
              <ProductCard key={i} ctx={ctx} card={c} waNumber={waNumber} buttonLabel={buttonLabel} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------- UmkmPromoBanner ---------------------------

function Promo({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  const discount = s(p, "discountLabel");
  const headline = s(p, "headline");
  const desc = s(p, "description");
  const code = s(p, "voucherCode");
  const valid = s(p, "validUntil");
  const ctaLabel = s(p, "ctaLabel");
  const waNumber = s(p, "waNumber");
  const href = waNumber
    ? waLink(waNumber, code ? `Halo, saya mau pakai kode voucher ${code}` : `Halo, saya mau tanya promo ${headline}`)
    : s(p, "ctaHref") || "#";
  return (
    <section className="wb-umkm wb-umkm-promo">
      <div className="wb-umkm-wrap">
        <div className="wb-umkm-promo-card">
          <div className="wb-umkm-promo-main">
            {show(ctx, discount) && (
              <span className="wb-umkm-promo-tag">
                <Icon name="tag" small />
                {ctx.text({ as: "span", value: discount, path: ["discountLabel"], placeholder: "Diskon 20%" })}
              </span>
            )}
            {ctx.text({ as: "h2", className: "wb-umkm-promo-title", value: headline, path: ["headline"], placeholder: "Judul promo…" })}
            {show(ctx, desc) &&
              ctx.text({ as: "p", className: "wb-umkm-promo-desc", value: desc, path: ["description"], placeholder: "Syarat & ketentuan singkat…", multiline: true })}
            {show(ctx, valid) && (
              <p className="wb-umkm-promo-valid">
                <Icon name="clock" small />
                {ctx.text({ as: "span", value: valid, path: ["validUntil"], placeholder: "Berlaku sampai…" })}
              </p>
            )}
          </div>
          {(show(ctx, code) || show(ctx, ctaLabel)) && (
            <div className="wb-umkm-promo-side">
              {show(ctx, code) && (
                <div className="wb-umkm-voucher">
                  <span className="wb-umkm-voucher-label">Kode voucher</span>
                  <div className="wb-umkm-voucher-row">
                    {ctx.text({ as: "span", className: "wb-umkm-voucher-code", value: code, path: ["voucherCode"], placeholder: "KODE" })}
                    {code ? <UmkmCopyCode code={code} /> : null}
                  </div>
                </div>
              )}
              {show(ctx, ctaLabel) && (
                <a className="wb-umkm-btn wb-umkm-btn--light wb-umkm-btn--lg wb-umkm-btn--block" {...linkAttrs(ctx, href)}>
                  {waNumber ? <WaIcon /> : null}
                  {ctx.text({ as: "span", value: ctaLabel, path: ["ctaLabel"], placeholder: "Label tombol…" })}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ----------------------------- UmkmStoreInfo ----------------------------

function InfoRow({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="wb-umkm-info-row">
      <span className="wb-umkm-info-ic">
        <Icon name={icon} />
      </span>
      <div className="wb-umkm-info-body">
        <div className="wb-umkm-info-label">{label}</div>
        {children}
      </div>
    </div>
  );
}

function StoreInfo({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  const address = s(p, "address");
  const phone = s(p, "phone");
  const waNumber = s(p, "waNumber");
  const email = s(p, "email");
  const hours = list(p, "hours");
  const areas = strs(p, "areas");
  const showMap = s(p, "showMap") !== "no";
  const embed = mapEmbedSrc(s(p, "mapSrc"), address);
  const directions = mapDirectionsHref(address);
  return (
    <section className="wb-umkm wb-umkm-store" id={anchor(p)}>
      <div className="wb-umkm-wrap">
        <Head ctx={ctx} p={p} />
        <div className="wb-umkm-store-grid">
          <div className="wb-umkm-store-info">
            {show(ctx, address) && (
              <InfoRow icon="pin" label="Alamat">
                {ctx.text({ as: "p", className: "wb-umkm-info-text", value: address, path: ["address"], placeholder: "Alamat lengkap toko…", multiline: true })}
                {address ? (
                  <a className="wb-umkm-link" {...linkAttrs(ctx, directions)}>
                    Petunjuk arah
                    <Icon name="arrow" small />
                  </a>
                ) : null}
              </InfoRow>
            )}
            {hours.length > 0 && (
              <InfoRow icon="clock" label="Jam buka">
                <ul className="wb-umkm-hours">
                  {hours.map((h, i) => (
                    <li key={i}>
                      {ctx.text({ as: "span", className: "wb-umkm-hours-day", value: s(h, "day"), path: ["hours", i, "day"], placeholder: "Hari…" })}
                      {ctx.text({ as: "span", className: "wb-umkm-hours-time", value: s(h, "hours"), path: ["hours", i, "hours"], placeholder: "08.00 – 21.00" })}
                    </li>
                  ))}
                </ul>
              </InfoRow>
            )}
            {(show(ctx, phone) || waNumber) && (
              <InfoRow icon="phone" label="Telepon & WhatsApp">
                {show(ctx, phone) &&
                  ctx.text({ as: "p", className: "wb-umkm-info-text", value: phone, path: ["phone"], placeholder: "0812-xxxx-xxxx" })}
                <div className="wb-umkm-contact-actions">
                  {waNumber ? (
                    <a
                      className="wb-umkm-btn wb-umkm-btn--primary wb-umkm-btn--sm"
                      {...linkAttrs(ctx, waLink(waNumber, s(p, "waMessage")))}
                    >
                      <WaIcon />
                      <span>Chat WhatsApp</span>
                    </a>
                  ) : null}
                  {phone ? (
                    <a className="wb-umkm-btn wb-umkm-btn--ghost wb-umkm-btn--sm" {...linkAttrs(ctx, telHref(phone))}>
                      <Icon name="phone" small />
                      <span>Telepon</span>
                    </a>
                  ) : null}
                </div>
              </InfoRow>
            )}
            {show(ctx, email) && (
              <InfoRow icon="mail" label="Email">
                <a className="wb-umkm-link" {...linkAttrs(ctx, `mailto:${email}`)}>
                  {ctx.text({ as: "span", value: email, path: ["email"], placeholder: "email@toko.id" })}
                </a>
              </InfoRow>
            )}
            {areas.some((a) => show(ctx, a)) && (
              <InfoRow icon="delivery" label="Area pengiriman">
                <ul className="wb-umkm-areas">
                  {areas.map((a, i) =>
                    show(ctx, a) ? (
                      <li key={i} className="wb-umkm-area">
                        {ctx.text({ as: "span", value: a, path: ["areas", i], placeholder: "Kota…" })}
                      </li>
                    ) : null,
                  )}
                </ul>
              </InfoRow>
            )}
          </div>
          {showMap && (
            <div className="wb-umkm-store-map">
              {embed && ctx.live ? (
                <iframe
                  src={embed}
                  title={`Peta lokasi ${s(p, "title")}`.trim()}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              ) : (
                <div className="wb-umkm-map-ph">
                  <Icon name="pin" />
                  <p className="wb-umkm-sub">
                    {ctx.live ? address || "Lokasi toko" : "Peta Google Maps tampil di situs live"}
                  </p>
                  {address ? (
                    <a className="wb-umkm-link" {...linkAttrs(ctx, directions)}>
                      Buka di Google Maps
                      <Icon name="external" small />
                    </a>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// -------------------------- UmkmMarketplaceLinks ------------------------

function Marketplace({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  return (
    <section className="wb-umkm wb-umkm-mp">
      <div className="wb-umkm-wrap">
        <Head ctx={ctx} p={p} />
        <div className="wb-umkm-mp-list">
          {list(p, "items").map((it, i) => {
            const pf = UMKM_PLATFORMS[s(it, "platform")] ?? UMKM_PLATFORMS.website;
            const label = s(it, "label");
            return (
              <a key={i} className="wb-umkm-mp-pill" {...linkAttrs(ctx, s(it, "url"))}>
                <span className="wb-umkm-mp-dot" style={{ background: pf.color }} aria-hidden="true">
                  {pf.short}
                </span>
                <span className="wb-umkm-mp-text">
                  <span className="wb-umkm-mp-name">{pf.label}</span>
                  {show(ctx, label) &&
                    ctx.text({ as: "span", className: "wb-umkm-mp-label", value: label, path: ["items", i, "label"], placeholder: "Nama toko…" })}
                </span>
                <Icon name="external" small />
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------- UmkmTrustBadges ---------------------------

function Trust({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  return (
    <section className="wb-umkm wb-umkm-trust">
      <div className="wb-umkm-wrap">
        <Head ctx={ctx} p={p} />
        <ul className="wb-umkm-trust-grid">
          {list(p, "items").map((it, i) => (
            <li key={i} className="wb-umkm-trust-item">
              <span className="wb-umkm-trust-ic">
                <Icon name={s(it, "icon")} />
              </span>
              {ctx.text({ as: "h3", className: "wb-umkm-trust-title", value: s(it, "title"), path: ["items", i, "title"], placeholder: "Judul…" })}
              {show(ctx, s(it, "desc")) &&
                ctx.text({ as: "p", className: "wb-umkm-trust-desc", value: s(it, "desc"), path: ["items", i, "desc"], placeholder: "Keterangan singkat…", multiline: true })}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ------------------------------ UmkmReviews -----------------------------

function Reviews({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  const title = s(p, "title");
  const subtitle = s(p, "subtitle");
  const average = s(p, "average");
  const count = s(p, "countText");
  const avgStars = clampRating(Number.parseFloat(average.replace(",", ".")) || 5);
  return (
    <section className="wb-umkm wb-umkm-reviews">
      <div className="wb-umkm-wrap">
        <header className="wb-umkm-head">
          {show(ctx, title) &&
            ctx.text({ as: "h2", className: "wb-umkm-title", value: title, path: ["title"], placeholder: "Judul section…" })}
          {show(ctx, subtitle) &&
            ctx.text({ as: "p", className: "wb-umkm-sub", value: subtitle, path: ["subtitle"], placeholder: "Subjudul (opsional)…" })}
          {(show(ctx, average) || show(ctx, count)) && (
            <div className="wb-umkm-rev-summary">
              {ctx.text({ as: "span", className: "wb-umkm-rev-avg", value: average, path: ["average"], placeholder: "4.9" })}
              <span className="wb-umkm-rev-meta">
                <Stars rating={avgStars} />
                {ctx.text({ as: "span", value: count, path: ["countText"], placeholder: "dari 100+ ulasan" })}
              </span>
            </div>
          )}
        </header>
        <div className="wb-umkm-rev-list">
          {list(p, "items").map((it, i) => {
            const name = s(it, "name");
            const photo = s(it, "photo");
            return (
              <figure key={i} className="wb-umkm-rev">
                <Stars rating={clampRating(s(it, "rating") || 5)} />
                {ctx.text({ as: "p", className: "wb-umkm-rev-text", value: s(it, "text"), path: ["items", i, "text"], placeholder: "Isi ulasan…", multiline: true })}
                <figcaption className="wb-umkm-rev-author">
                  <span className="wb-umkm-avatar">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={name} loading="lazy" decoding="async" />
                    ) : (
                      initialOf(name)
                    )}
                  </span>
                  <div>
                    {ctx.text({ as: "div", className: "wb-umkm-rev-name", value: name, path: ["items", i, "name"], placeholder: "Nama…" })}
                    {show(ctx, s(it, "location")) &&
                      ctx.text({ as: "div", className: "wb-umkm-rev-loc", value: s(it, "location"), path: ["items", i, "location"], placeholder: "Kota · produk…" })}
                  </div>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --------------------------- UmkmWhatsAppFloat --------------------------

function WaFloat({ ctx, p }: { ctx: UmkmCtx; p: Props }) {
  const label = s(p, "label");
  const left = s(p, "position") === "left";
  let cls = "wb-umkm-wa-float";
  if (left) cls += " wb-umkm-wa-float--left";
  if (s(p, "color") === "theme") cls += " wb-umkm-wa-float--theme";
  if (!ctx.live) cls += " is-inline";
  const float = (
    <div className={cls}>
      {show(ctx, label) &&
        ctx.text({ as: "span", className: "wb-umkm-wa-bubble", value: label, path: ["label"], placeholder: "Tanya admin" })}
      <a
        className="wb-umkm-wa-fab"
        aria-label={label ? `${label} via WhatsApp` : "Chat via WhatsApp"}
        {...linkAttrs(ctx, waLink(s(p, "waNumber"), s(p, "waMessage")))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: UMKM_WA_PATH }} />
      </a>
    </div>
  );
  // Live: fixed to the viewport, outside .wb-umkm (its container query would
  // otherwise become the containing block for position:fixed).
  if (ctx.live) return float;
  return (
    <section className="wb-umkm wb-umkm-wa-section">
      <div className="wb-umkm-wrap">
        <div className="wb-umkm-wa-preview">
          <p className="wb-umkm-wa-note">
            Tombol WhatsApp ini melayang di pojok {left ? "kiri" : "kanan"} bawah layar pengunjung.
          </p>
          {float}
        </div>
      </div>
    </section>
  );
}

// renderUmkmBlock returns null for non-UMKM types. Catalog needs cards from the caller.
export function renderUmkmBlock(
  type: string,
  props: Props | undefined,
  ctx: UmkmCtx,
  catalog?: { cards: UmkmCard[]; note?: string },
): ReactNode {
  const p = props ?? {};
  switch (type) {
    case "UmkmHero":
      return <Hero ctx={ctx} p={p} />;
    case "UmkmProductShowcase":
      return <Showcase ctx={ctx} p={p} />;
    case "UmkmCatalogDynamic":
      return <UmkmCatalogView ctx={ctx} p={p} cards={catalog?.cards ?? []} note={catalog?.note} />;
    case "UmkmPromoBanner":
      return <Promo ctx={ctx} p={p} />;
    case "UmkmStoreInfo":
      return <StoreInfo ctx={ctx} p={p} />;
    case "UmkmMarketplaceLinks":
      return <Marketplace ctx={ctx} p={p} />;
    case "UmkmTrustBadges":
      return <Trust ctx={ctx} p={p} />;
    case "UmkmReviews":
      return <Reviews ctx={ctx} p={p} />;
    case "UmkmWhatsAppFloat":
      return <WaFloat ctx={ctx} p={p} />;
  }
  return null;
}

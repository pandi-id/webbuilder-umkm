// ProductReviews — server component: rating summary + approved reviews +
// the (client) submit form. Only published rows ever reach here.
import type { ProductReview, ReviewSummary } from "@/lib/api";
import { ReviewForm } from "./ReviewForm";
import { Stars } from "./Stars";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

// Histogram of how many reviews gave each star, 5 down to 1. Reads the
// server-side breakdown, not the fetched page, so the bars add up to `count`.
function Breakdown({ summary }: { summary: ReviewSummary }) {
  if (summary.count === 0) return null;
  const at = (star: number) => summary.breakdown?.[star - 1] ?? 0;
  return (
    <div className="wb-rev-bars">
      {[5, 4, 3, 2, 1].map((star) => {
        const n = at(star);
        return (
          <div key={star} className="wb-rev-bar-row">
            <span className="wb-rev-bar-label">{star}</span>
            <span className="wb-rev-bar-track">
              <span
                className="wb-rev-bar-fill"
                style={{ width: `${(n / summary.count) * 100}%` }}
              />
            </span>
            <span className="wb-rev-bar-n">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ProductReviews({
  siteId,
  slug,
  items,
  summary,
}: {
  siteId: string;
  slug: string;
  items: ProductReview[];
  summary: ReviewSummary;
}) {
  return (
    <section className="wb-rev" id="ulasan">
      <h2 className="wb-rev-title">Ulasan Pembeli</h2>

      {summary.count > 0 ? (
        <div className="wb-rev-summary">
          <div className="wb-rev-avg">
            <span className="wb-rev-avg-num">{summary.average.toFixed(1)}</span>
            <Stars rating={summary.average} size={18} />
            <span className="wb-rev-avg-count">
              {summary.count} ulasan
            </span>
          </div>
          <Breakdown summary={summary} />
        </div>
      ) : (
        <p className="wb-rev-empty">
          Belum ada ulasan untuk produk ini. Jadilah yang pertama memberi ulasan!
        </p>
      )}

      {items.length > 0 && (
        <ul className="wb-rev-list">
          {items.map((r) => (
            <li key={r.id} className="wb-rev-item">
              <div className="wb-rev-head">
                <span className="wb-rev-avatar" aria-hidden="true">
                  {initialOf(r.author_name)}
                </span>
                <div className="wb-rev-who">
                  <span className="wb-rev-name">
                    {r.author_name}
                    {r.verified_buyer && (
                      <span className="wb-rev-verified" title="Pernah berbelanja di toko ini">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 12.5l2 2 4-4.5" />
                          <circle cx="12" cy="12" r="9" />
                        </svg>
                        Pembeli terverifikasi
                      </span>
                    )}
                  </span>
                  <span className="wb-rev-meta">
                    <Stars rating={r.rating} size={13} />
                    <time dateTime={r.created_at}>{formatDate(r.created_at)}</time>
                  </span>
                </div>
              </div>
              {r.body && <p className="wb-rev-body">{r.body}</p>}
              {r.reply && (
                <div className="wb-rev-reply">
                  <span className="wb-rev-reply-label">Balasan penjual</span>
                  <p>{r.reply}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ReviewForm siteId={siteId} slug={slug} />
    </section>
  );
}

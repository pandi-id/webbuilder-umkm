// Stars — shared rating glyphs for the storefront. Server-safe (no hooks) so
// both the review list and the summary header can use it.
export function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  const full = Math.round(rating);
  return (
    <span
      className="wb-rev-stars"
      role="img"
      aria-label={`${rating.toFixed(1)} dari 5 bintang`}
      style={{ ["--wb-star-size" as string]: `${size}px` }}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={i <= full ? "wb-rev-star is-on" : "wb-rev-star"}
        >
          <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" />
        </svg>
      ))}
    </span>
  );
}

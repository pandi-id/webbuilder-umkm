// Shared helpers for the store dashboard (site overview + sites list).

export type ThemeJson = {
  colors?: { primary?: string; secondary?: string; bg?: string; fg?: string };
};

// Event fired whenever a site's publish status changes, so the layout header
// and the overview page stay in sync without a shared store.
export const SITE_STATUS_EVENT = "site:status";
export type SiteStatusDetail = { siteId: string; status: string };

export function emitSiteStatus(siteId: string, status: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SiteStatusDetail>(SITE_STATUS_EVENT, { detail: { siteId, status } }),
  );
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("id-ID").format(n);
}

export function fmtPrice(amount: number, currency = "IDR"): string {
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: currency || "IDR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${fmtNumber(amount)}`;
  }
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} hari lalu`;
  return fmtDate(iso);
}

export function initials(source: string): string {
  const parts = source.trim().split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Hex-only guard: theme colors come from user input, so never trust them
// straight into inline CSS.
function safeHex(v: string | undefined, fallback: string): string {
  return v && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

export function themeGradient(theme: ThemeJson | null | undefined): string {
  const p = safeHex(theme?.colors?.primary, "#2563eb");
  const s = safeHex(theme?.colors?.secondary, p);
  return `linear-gradient(135deg, ${p} 0%, ${s} 100%)`;
}

// Fired by the Pesanan page after it (re)loads the summary or changes a status,
// so the sidebar "new orders" badge updates without waiting for navigation.
export const ORDERS_SUMMARY_EVENT = "site:orders-summary";
export type OrdersSummaryDetail = { siteId: string; newCount: number };

export function emitOrdersSummary(siteId: string, newCount: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OrdersSummaryDetail>(ORDERS_SUMMARY_EVENT, { detail: { siteId, newCount } }),
  );
}

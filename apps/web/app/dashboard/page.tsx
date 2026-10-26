"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Store,
  UserCheck,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NoticeBanner } from "@/components/site-dashboard/NoticeBanner";
import {
  SiteCard,
  SiteCardSkeleton,
  type SiteCardData,
} from "@/components/site-dashboard/SiteCard";

type Site = SiteCardData & {
  // 'owner' = own site; 'editor'/'viewer' = collaborator (e.g. reseller buying for a client).
  role?: "owner" | "editor" | "viewer";
};

// MeProfile — subset dari /auth/me yang dipakai untuk cek kelengkapan profil.
// Field ini wajib saat beli domain (WHOIS + EPP contact).
type MeProfile = {
  name: string;
  phone_number: string;
  address: string;
  city: string;
  postal_code: string;
  nik: string;
};

const PROFILE_FIELD_LABEL: Record<keyof MeProfile, string> = {
  name: "Nama lengkap",
  phone_number: "Nomor HP",
  address: "Alamat",
  city: "Kota",
  postal_code: "Kode pos",
  nik: "NIK (untuk .id)",
};

function missingProfileFields(m: MeProfile | null): Array<keyof MeProfile> {
  if (!m) return [];
  const keys: Array<keyof MeProfile> = [
    "name",
    "phone_number",
    "address",
    "city",
    "postal_code",
    "nik",
  ];
  return keys.filter((k) => !(m[k] ?? "").trim());
}

// Purchase = shape yang di-return /api/v1/domains/purchases. Detail flow
// tetap di /sites/pending/[jobId] & /settings/domains/[name].
type DomainPurchase = {
  job_id: string;
  domain: string;
  status: string;
  kind: string;
  payment_url?: string;
  expires_at?: string;
  site_id?: string; // null = domain aktif tapi belum ada situs → prompt "Buat toko"
};

// Non-terminal states worth surfacing on the dashboard.
const ACTIONABLE_STATUSES = new Set([
  "pending_payment",
  "pending_document",
  "pending_provisioning",
]);

// Ambang batas peringatan expire — konsisten dengan /settings/domains (formatExpiry).
const EXPIRY_WARN_DAYS = 30;

const CREATE_HREF = "/sites/new-with-domain";

export default function DashboardPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadingSites, setLoadingSites] = useState(true);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [profileDismissed, setProfileDismissed] = useState<boolean>(false);
  const [pendingPurchases, setPendingPurchases] = useState<DomainPurchase[]>([]);
  // Deduped: hidden when the same domain already has a pending/active row (user recovered).
  const [failedPurchases, setFailedPurchases] = useState<DomainPurchase[]>([]);
  // Missing a renewal takes the store offline, so surface ≤ 30-day expiries.
  const [expiringPurchases, setExpiringPurchases] = useState<DomainPurchase[]>([]);
  const [activeDomains, setActiveDomains] = useState<DomainPurchase[]>([]);

  async function refresh() {
    setLoadingSites(true);
    try {
      // Go can marshal a nil slice to null — normalise to [].
      const list = (await api<Site[]>("/api/v1/sites")) ?? [];
      setSites(list);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingSites(false);
    }
  }

  useEffect(() => {
    refresh();
    api<MeProfile>("/api/v1/auth/me")
      .then((u) => setMe(u))
      .catch(() => {});
    // sessionStorage so the reminder returns next session if still incomplete.
    try {
      if (sessionStorage.getItem("dashboard_profile_banner_dismissed") === "1") {
        setProfileDismissed(true);
      }
    } catch {
      /* sessionStorage disabled — keep banner */
    }
    // Poll every 30s so webhook-driven status changes show without reload.
    let cancelled = false;
    async function refreshPurchases() {
      try {
        // limit 100: the expiry sweep needs every active row.
        const list = await api<DomainPurchase[]>("/api/v1/domains/purchases?limit=100");
        if (cancelled) return;
        const items = list ?? [];
        setPendingPurchases(items.filter((p) => ACTIONABLE_STATUSES.has(p.status)));
        const inProgress = new Set<string>();
        for (const p of items) {
          if (p.status === "active" || ACTIONABLE_STATUSES.has(p.status)) {
            inProgress.add(p.domain);
          }
        }
        const seenFailed = new Set<string>();
        const failed: DomainPurchase[] = [];
        for (const p of items) {
          if (p.status !== "failed") continue;
          if (inProgress.has(p.domain)) continue;
          if (seenFailed.has(p.domain)) continue;
          seenFailed.add(p.domain);
          failed.push(p);
        }
        setFailedPurchases(failed);
        // Per-domain, not per-row: after a renew the register row keeps the old expiry.
        setExpiringPurchases(latestActivePerDomain(items).filter(isExpiringSoon));
        // Register-kind only: renew rows don't add a new domain entity.
        setActiveDomains(items.filter((p) => p.status === "active" && p.kind === "register"));
      } catch {
        /* silent — dashboard tidak block */
      }
    }
    refreshPurchases();
    const iv = setInterval(refreshPurchases, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  const domainBySite = new Map<string, string>();
  for (const d of activeDomains) if (d.site_id) domainBySite.set(d.site_id, d.domain);
  const unattachedDomains = latestActivePerDomain(activeDomains).filter((d) => !d.site_id);
  const publishedCount = sites.filter((s) => s.status === "published").length;
  const missingProfile = missingProfileFields(me);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-md bg-primary/10">
              <Store className="size-4 text-primary" />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Dashboard
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Toko Saya</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loadingSites
              ? "Memuat…"
              : sites.length === 0
                ? "Belum ada toko — beli domain untuk mulai berjualan online."
                : `${sites.length} toko · ${publishedCount} sudah dipublikasikan`}
          </p>
        </div>
        {/* Single create flow: buy a domain, then build the store (1 domain = 1 situs). */}
        <Button className="w-full shadow-sm sm:w-auto" asChild>
          <Link href={CREATE_HREF}>
            <Plus />
            Beli Domain + Buat Toko
          </Link>
        </Button>
      </div>

      {err && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>
            <span className="font-medium">Gagal memuat:</span> {err}
          </span>
        </div>
      )}

      {/* Notices — compact so they never push the store grid off-screen. */}
      {(expiringPurchases.length > 0 ||
        pendingPurchases.length > 0 ||
        failedPurchases.length > 0 ||
        (me && !profileDismissed && missingProfile.length > 0)) && (
        <div className="space-y-2">
          {expiringPurchases.length > 0 && (
            <NoticeBanner
              tone="red"
              icon={<AlertTriangle className="size-4 shrink-0" />}
              title="Domain akan segera expire"
              linkLabel="Kelola domain"
              linkHref="/settings/domains"
              rows={expiringPurchases.map((p) => ({
                key: p.job_id,
                href: `/settings/domains/${encodeURIComponent(p.domain)}`,
                domain: p.domain,
                badge: (
                  <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px]">
                    <RefreshCw className="size-2.5" />
                    {expiryLabel(p)}
                  </Badge>
                ),
              }))}
            />
          )}

          {pendingPurchases.length > 0 && (
            <NoticeBanner
              tone="amber"
              icon={<Loader2 className="size-4 shrink-0 animate-spin" />}
              title="Domain sedang diproses"
              linkLabel="Lihat semua domain"
              linkHref="/settings/domains"
              rows={pendingPurchases.map((p) => ({
                key: p.job_id,
                href: `/sites/pending/${p.job_id}`,
                domain: p.domain,
                badge: (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {statusCopy(p.status)}
                  </Badge>
                ),
              }))}
            />
          )}

          {failedPurchases.length > 0 && (
            <NoticeBanner
              tone="red"
              icon={<AlertCircle className="size-4 shrink-0" />}
              title="Domain gagal — perlu perhatian"
              linkLabel="Lihat semua domain"
              linkHref="/settings/domains"
              rows={failedPurchases.map((p) => ({
                key: p.job_id,
                href: `/sites/pending/${p.job_id}`,
                domain: p.domain,
                badge: (
                  <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                    {p.kind === "renew" ? "Renew gagal · coba lagi" : "Gagal · coba lagi"}
                  </Badge>
                ),
              }))}
            />
          )}

          {me && !profileDismissed && missingProfile.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex items-center gap-2 font-medium">
                <UserCheck className="size-4 shrink-0" />
                Lengkapi profil sebelum beli domain
              </div>
              <span
                className="min-w-0 flex-1 truncate text-xs opacity-80"
                title={missingProfile.map((k) => PROFILE_FIELD_LABEL[k]).join(", ")}
              >
                Belum diisi: {missingProfile.map((k) => PROFILE_FIELD_LABEL[k]).join(", ")}
              </span>
              <div className="flex items-center gap-1">
                <Link
                  href="/settings/profile"
                  className="text-xs font-medium underline underline-offset-4"
                >
                  Lengkapi
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setProfileDismissed(true);
                    try {
                      sessionStorage.setItem("dashboard_profile_banner_dismissed", "1");
                    } catch {
                      /* ignore write failure */
                    }
                  }}
                  aria-label="Tutup pemberitahuan"
                  title="Tutup (muncul lagi di sesi berikutnya)"
                  className="grid size-6 place-items-center rounded-md transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Paid domains with no store yet — the one action that unblocks them. */}
      {unattachedDomains.length > 0 && <UnattachedDomains domains={unattachedDomains} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loadingSites &&
          sites.length === 0 &&
          Array.from({ length: 3 }).map((_, i) => <SiteCardSkeleton key={i} />)}

        {!loadingSites && sites.length === 0 && !err && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10">
              <Store className="size-7 text-primary" />
            </div>
            <h3 className="mt-4 text-base font-semibold">Belum ada toko online</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Beli domain .id untuk toko Anda, pilih template, lalu tambahkan produk. Selesai
              dalam beberapa menit.
            </p>
            <Button asChild className="mt-5 shadow-sm">
              <Link href={CREATE_HREF}>
                <Globe2 />
                Beli Domain + Buat Toko
              </Link>
            </Button>
          </div>
        )}

        {sites.map((s) => (
          <SiteCard key={s.id} site={s} domain={domainBySite.get(s.id) ?? null} />
        ))}

        {!loadingSites && sites.length > 0 && (
          <Link
            href={CREATE_HREF}
            className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 p-8 text-center text-muted-foreground transition-colors hover:border-primary/50 hover:bg-card hover:text-foreground"
          >
            <div className="grid size-11 place-items-center rounded-full border-2 border-dashed">
              <Plus className="size-5" />
            </div>
            <div>
              <div className="text-sm font-medium">Buat toko baru</div>
              <div className="mt-0.5 text-xs">Mulai dengan membeli domain</div>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}

function UnattachedDomains({ domains }: { domains: DomainPurchase[] }) {
  return (
    <Card className="border-primary/30 bg-primary/5 p-3 sm:p-4">
      <div className="mb-2.5 flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" />
        {domains.length} domain siap dibuatkan toko
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {domains.map((d) => (
          <li
            key={d.job_id}
            className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
          >
            <Globe2 className="size-4 shrink-0 text-muted-foreground" />
            <code className="min-w-0 flex-1 truncate text-sm font-medium">{d.domain}</code>
            <Button asChild size="sm" className="h-8 shrink-0">
              <Link href={`/sites/pending/${d.job_id}`}>
                Buat toko
                <ArrowRight />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function expiryLabel(p: DomainPurchase): string {
  const days = p.expires_at ? daysUntil(p.expires_at) : 0;
  if (days < 0) return `expire ${Math.abs(days)} hari lalu`;
  if (days === 0) return "expire hari ini";
  return `sisa ${days} hari`;
}

// statusCopy — mapping raw registrar status → label Indonesia untuk kartu
// "Domain sedang diproses" di dashboard. Sinkron dengan STATUS_INFO di
// /sites/pending/[jobId] tapi ringkas (satu kata) untuk badge kecil.
function statusCopy(status: string): string {
  switch (status) {
    case "pending_payment":
      return "Menunggu bayar";
    case "pending_document":
      return "Menunggu dokumen";
    case "pending_provisioning":
      return "Diproses registrar";
    default:
      return status;
  }
}

// isExpiringSoon — filter untuk expiry warning banner. Active + expires_at
// dalam ≤ EXPIRY_WARN_DAYS (termasuk yang sudah lewat/negatif). Kind tidak
// difilter karena input sudah di-dedupe latestActivePerDomain — kalau ada
// renew active untuk domain, itu yang jadi source of truth expires_at.
function isExpiringSoon(p: DomainPurchase): boolean {
  if (p.status !== "active" || !p.expires_at) return false;
  const dt = new Date(p.expires_at);
  if (isNaN(dt.getTime())) return false;
  const days = Math.round((dt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return days <= EXPIRY_WARN_DAYS;
}

// latestActivePerDomain — dedupe active purchases by domain, ambil yang
// `expires_at` paling akhir. Menghindari 2 baris untuk 1 domain (register +
// renew) di UI dan memastikan tanggal yang ditampilkan konsisten dengan
// backend notifier (yang juga DISTINCT ON per domain by max expires_at).
function latestActivePerDomain(items: DomainPurchase[]): DomainPurchase[] {
  const byDomain = new Map<string, DomainPurchase>();
  for (const p of items) {
    if (p.status !== "active") continue;
    const cur = byDomain.get(p.domain);
    if (!cur) {
      byDomain.set(p.domain, p);
      continue;
    }
    const curTs = cur.expires_at ? new Date(cur.expires_at).getTime() : 0;
    const newTs = p.expires_at ? new Date(p.expires_at).getTime() : 0;
    if (newTs > curTs) byDomain.set(p.domain, p);
  }
  return Array.from(byDomain.values());
}

// daysUntil — days remaining sampai iso date; negatif = sudah expire.
function daysUntil(iso: string): number {
  const dt = new Date(iso);
  return Math.round((dt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}


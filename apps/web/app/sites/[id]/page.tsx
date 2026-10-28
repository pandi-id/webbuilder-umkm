"use client";

// Store overview — landing page of every site. Each widget fetches
// independently and degrades to "—" so one failing endpoint never blanks the page.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  ExternalLink,
  Eye,
  Globe2,
  ImageIcon,
  Inbox,
  Package,
  Palette,
  PenLine,
  Plus,
  Receipt,
  SquarePen,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  errMessage,
  hasRealWhatsapp,
  type OrderPage,
  type OrderSummary,
} from "@/lib/api";
import type { PaginatedResult } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatCard } from "@/components/site-dashboard/StatCard";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { fmtOrderTotal, itemsSummary } from "@/components/orders/utils";
import {
  OnboardingChecklist,
  type ChecklistItem,
} from "@/components/site-dashboard/OnboardingChecklist";
import {
  SITE_STATUS_EVENT,
  emitSiteStatus,
  fmtNumber,
  fmtPrice,
  initials,
  themeGradient,
  timeAgo,
  type SiteStatusDetail,
  type ThemeJson,
} from "@/components/site-dashboard/utils";

type Block = { type?: string; props?: Record<string, unknown>; children?: unknown };

type SiteDetail = {
  id: string;
  name: string;
  status: string;
  theme: ThemeJson | null;
  layout: { header?: Block[]; footer?: Block[] } | null;
  whatsapp_number?: string;
};

type PageItem = { id: string; slug: string; is_home: boolean; tree: unknown };

type DomainRow = { hostname: string; is_primary: boolean; status: string };
type PurchaseItem = { domain: string; status: string; kind: string; site_id?: string | null };
type LegacyDomain = { hostname: string; status: string };

type Product = {
  id: string;
  name: string;
  price: number;
  currency: string;
  image_url: string;
  status: string;
};

type Form = { id: string; name: string };
type Submission = {
  id: string;
  form_id: string;
  data: Record<string, unknown> | null;
  submitted_at: string;
};
type SubmissionPage = { items: Submission[]; total: number };

type AnalyticsSummary = { total_views: number; views_today: number };

type Message = Submission & { formName: string };

// Domain states that serve traffic (purchase "active", BYO "verified"/"drifting").
const LIVE_DOMAIN_STATUSES = new Set(["active", "verified", "drifting"]);

// Navbar brand values shipped by built-in templates — still showing one of
// these means the owner hasn't put their store name in the header yet.
const PLACEHOLDER_BRANDS = new Set(
  [
    "toko bahagia", "kopi senja", "sekar batik", "anyam lestari",
    "nama saya", "pak budi", "sekolah abc", "blog saya", "brand", "logo",
  ],
);

const MIN_PRODUCTS = 3;

function parseTree(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

// Depth-first walk over a block tree; accepts either an array or {blocks: []}.
function walkBlocks(nodes: unknown, visit: (b: Block) => boolean | void): boolean {
  const list = Array.isArray(nodes)
    ? nodes
    : nodes && typeof nodes === "object" && Array.isArray((nodes as { blocks?: unknown }).blocks)
      ? (nodes as { blocks: unknown[] }).blocks
      : [];
  for (const n of list) {
    if (!n || typeof n !== "object") continue;
    const b = n as Block;
    if (visit(b) === true) return true;
    if (b.children && walkBlocks(b.children, visit)) return true;
  }
  return false;
}

function findBrand(site: SiteDetail | null, pages: PageItem[] | null): string | null {
  let brand: string | null = null;
  const visit = (b: Block) => {
    if (b.type === "Navbar") {
      brand = String(b.props?.brand ?? "").trim();
      return true;
    }
  };
  if (site?.layout?.header && walkBlocks(site.layout.header, visit)) return brand;
  const home = pages?.find((p) => p.is_home) ?? pages?.[0];
  if (home && walkBlocks(parseTree(home.tree), visit)) return brand;
  return null;
}

// Submission data is free-form JSON; pick the most likely sender + message fields.
function pickField(data: Record<string, unknown> | null, keys: string[]): string {
  if (!data) return "";
  for (const k of Object.keys(data)) {
    if (keys.includes(k.toLowerCase())) {
      const v = data[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

function messagePreview(m: Message): { sender: string; body: string } {
  const sender =
    pickField(m.data, ["name", "nama", "full_name", "nama_lengkap"]) ||
    pickField(m.data, ["email", "phone", "telepon", "whatsapp", "wa", "hp"]) ||
    "Pengunjung";
  let body = pickField(m.data, ["message", "pesan", "body", "isi", "comment", "komentar"]);
  if (!body && m.data) {
    body = Object.values(m.data).filter((v) => typeof v === "string").join(" · ");
  }
  return { sender, body: body || "(tanpa isi pesan)" };
}

async function resolvePrimaryDomain(sid: string): Promise<string | null> {
  const combined = await api<DomainRow[]>(`/api/v1/sites/${sid}/domains-combined`).catch(() => null);
  if (combined) {
    const live = combined.filter((d) => LIVE_DOMAIN_STATUSES.has(d.status));
    return (live.find((d) => d.is_primary) ?? live[0])?.hostname ?? null;
  }
  // Fallback when the BYO module is disabled: purchase anchor, then legacy domains.
  const [purchases, legacy] = await Promise.all([
    api<PurchaseItem[]>("/api/v1/domains/purchases?limit=100").catch(() => null),
    api<LegacyDomain[]>(`/api/v1/sites/${sid}/domains`).catch(() => null),
  ]);
  const anchor = (purchases ?? []).find(
    (p) => p.site_id === sid && p.kind === "register" && p.status === "active",
  );
  if (anchor) return anchor.domain;
  return (legacy ?? []).find((d) => d.status === "verified")?.hostname ?? null;
}

async function loadMessages(sid: string): Promise<{ total: number; recent: Message[] } | null> {
  const forms = await api<Form[]>(`/api/v1/sites/${sid}/forms`).catch(() => null);
  if (!forms) return null;
  // Cap fan-out; stores rarely have more than a handful of forms.
  const pages = await Promise.all(
    forms.slice(0, 6).map((f) =>
      api<SubmissionPage>(`/api/v1/forms/${f.id}/submissions?page_size=5`)
        .then((r) => ({ form: f, page: r }))
        .catch(() => null),
    ),
  );
  let total = 0;
  const recent: Message[] = [];
  for (const p of pages) {
    if (!p) continue;
    total += p.page.total ?? 0;
    for (const s of p.page.items ?? []) recent.push({ ...s, formName: p.form.name });
  }
  recent.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
  return { total, recent: recent.slice(0, 4) };
}

export default function SiteOverviewPage() {
  const params = useParams<{ id: string }>();
  const sid = params.id;

  const [loading, setLoading] = useState(true);
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [pages, setPages] = useState<PageItem[] | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [products, setProducts] = useState<PaginatedResult<Product> | null>(null);
  const [orders, setOrders] = useState<OrderPage | null>(null);
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [messages, setMessages] = useState<{ total: number; recent: Message[] } | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [
        siteRes,
        pagesRes,
        domainRes,
        productsRes,
        ordersRes,
        orderSummaryRes,
        analyticsRes,
        messagesRes,
      ] = await Promise.all([
        api<SiteDetail>(`/api/v1/sites/${sid}`).catch(() => null),
        api<PageItem[]>(`/api/v1/sites/${sid}/pages`).catch(() => null),
        resolvePrimaryDomain(sid).catch(() => null),
        api<PaginatedResult<Product>>(
          `/api/v1/sites/${sid}/products?page_size=4&sort=newest`,
        ).catch(() => null),
        api<OrderPage>(`/api/v1/sites/${sid}/orders?page_size=4&sort=newest`).catch(() => null),
        api<OrderSummary>(`/api/v1/sites/${sid}/orders/summary`).catch(() => null),
        api<AnalyticsSummary>(`/api/v1/sites/${sid}/analytics?days=7`).catch(() => null),
        loadMessages(sid).catch(() => null),
      ]);
      if (cancelled) return;
      setSite(siteRes);
      setPages(pagesRes);
      setDomain(domainRes);
      setProducts(productsRes);
      setOrders(ordersRes);
      setOrderSummary(orderSummaryRes);
      setAnalytics(analyticsRes);
      setMessages(messagesRes);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sid]);

  // Header publish button lives in the layout; mirror its result here.
  useEffect(() => {
    function onStatus(e: Event) {
      const d = (e as CustomEvent<SiteStatusDetail>).detail;
      if (d?.siteId === sid) setSite((prev) => (prev ? { ...prev, status: d.status } : prev));
    }
    window.addEventListener(SITE_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(SITE_STATUS_EVENT, onStatus);
  }, [sid]);

  const publish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const updated = await api<{ status: string }>(`/api/v1/sites/${sid}/publish`, {
        method: "POST",
      });
      emitSiteStatus(sid, updated?.status ?? "published");
      toast.success("Toko berhasil dipublikasikan");
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setPublishing(false);
    }
  }, [sid, publishing]);

  const isPublished = site?.status === "published";
  const liveURL = domain ? `https://${domain}` : null;
  const productTotal = products ? products.total : null;
  const brand = findBrand(site, pages);
  const brandDone =
    !!brand &&
    (brand.toLowerCase() === site?.name.trim().toLowerCase() ||
      !PLACEHOLDER_BRANDS.has(brand.toLowerCase()));

  const checklist: ChecklistItem[] = [
    {
      key: "brand",
      title: "Pasang nama toko di header",
      description: "Ganti teks di bagian atas website dengan nama toko Anda, lalu atur warnanya.",
      done: brandDone,
      cta: "Buka Editor",
      href: `/sites/${sid}/editor`,
    },
    {
      key: "products",
      title: `Tambah minimal ${MIN_PRODUCTS} produk`,
      description:
        productTotal !== null && productTotal > 0
          ? `Sudah ${productTotal} dari ${MIN_PRODUCTS} produk. Sedikit lagi!`
          : "Lengkapi foto, nama, dan harga supaya pembeli tertarik.",
      done: (productTotal ?? 0) >= MIN_PRODUCTS,
      cta: "Tambah Produk",
      href: `/sites/${sid}/products`,
    },
    {
      key: "whatsapp",
      title: "Isi nomor WhatsApp toko",
      description: "Pesanan dari keranjang belanja dikirim ke nomor ini supaya bisa langsung Anda balas.",
      done: hasRealWhatsapp(site?.whatsapp_number),
      cta: "Isi Nomor",
      href: `/sites/${sid}/orders`,
    },
    {
      key: "publish",
      title: "Publikasikan toko",
      description: "Tayangkan toko supaya bisa dikunjungi lewat domain Anda.",
      done: isPublished,
      cta: "Publikasikan",
      onAction: publish,
      busy: publishing,
    },
  ];

  const viewsHint = analytics ? `Hari ini ${fmtNumber(analytics.views_today)}` : undefined;

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <Card className="overflow-hidden p-0">
        <div className="h-20 sm:h-24" style={{ background: themeGradient(site?.theme) }} />
        <div className="flex flex-col gap-4 px-4 pb-5 sm:px-6 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 items-end gap-4">
            <div className="-mt-10 grid size-20 shrink-0 place-items-center rounded-2xl border-4 border-card bg-card text-2xl font-bold shadow-sm">
              {site ? initials(site.name) : <div className="size-full animate-pulse rounded-xl bg-muted/50" />}
            </div>
            <div className="min-w-0 pb-1">
              {loading && !site ? (
                <div className="space-y-2">
                  <div className="h-6 w-48 animate-pulse rounded-md bg-muted/50" />
                  <div className="h-4 w-32 animate-pulse rounded-md bg-muted/50" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
                      {site?.name ?? "Toko Anda"}
                    </h1>
                    <Badge variant={isPublished ? "success" : "secondary"}>
                      {isPublished ? "Dipublikasikan" : "Draf"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Globe2 className="size-4 shrink-0" />
                    {domain ? (
                      <span className="truncate">{domain}</span>
                    ) : (
                      <Link href={`/sites/${sid}/domains`} className="hover:text-foreground hover:underline">
                        Domain belum aktif — cek status
                      </Link>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap md:justify-end">
            {liveURL ? (
              <Button variant="outline" asChild>
                <a href={liveURL} target="_blank" rel="noopener noreferrer" title={liveURL}>
                  <ExternalLink />
                  <span className="hidden sm:inline">Lihat Situs</span>
                  <span className="sm:hidden">Lihat</span>
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled title="Domain belum aktif">
                <ExternalLink />
                <span className="hidden sm:inline">Lihat Situs</span>
                <span className="sm:hidden">Lihat</span>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/sites/${sid}/theme`}>
                <Palette />
                <span className="hidden sm:inline">Edit Tampilan</span>
                <span className="sm:hidden">Tampilan</span>
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/sites/${sid}/editor`}>
                <SquarePen />
                <span className="hidden sm:inline">Buka Editor</span>
                <span className="sm:hidden">Editor</span>
              </Link>
            </Button>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Pesanan baru"
          value={orderSummary ? orderSummary.new : null}
          hint={
            orderSummary
              ? orderSummary.processing > 0
                ? `${fmtNumber(orderSummary.processing)} sedang diproses`
                : "Menunggu diproses"
              : undefined
          }
          icon={Receipt}
          tint="bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300"
          href={`/sites/${sid}/orders`}
          loading={loading}
        />
        <StatCard
          label="Jumlah produk"
          value={productTotal}
          hint="Di katalog toko"
          icon={Package}
          tint="bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300"
          href={`/sites/${sid}/products`}
          loading={loading}
        />
        <StatCard
          label="Pengunjung 7 hari"
          value={analytics ? analytics.total_views : null}
          hint={viewsHint}
          icon={Eye}
          tint="bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"
          href={`/sites/${sid}/analytics`}
          loading={loading}
        />
        <StatCard
          label="Pesan masuk"
          value={messages ? messages.total : null}
          hint="Dari formulir kontak"
          icon={Inbox}
          tint="bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300"
          href={`/sites/${sid}/forms`}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <OnboardingChecklist items={checklist} loading={loading} />
          <RecentOrders sid={sid} orders={orders} loading={loading} />
          <RecentProducts sid={sid} products={products} loading={loading} />
        </div>
        <div className="space-y-6">
          <QuickActions sid={sid} />
          <RecentMessages sid={sid} messages={messages} loading={loading} />
        </div>
      </div>
    </div>
  );
}

function QuickActions({ sid }: { sid: string }) {
  const actions = [
    { href: `/sites/${sid}/products`, icon: Plus, label: "Tambah Produk", tint: "text-orange-600 bg-orange-100 dark:bg-orange-950/50 dark:text-orange-300" },
    { href: `/sites/${sid}/blog/new`, icon: PenLine, label: "Tulis Artikel", tint: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300" },
    { href: `/sites/${sid}/editor`, icon: SquarePen, label: "Buka Editor", tint: "text-primary bg-primary/10" },
    { href: `/sites/${sid}/analytics`, icon: BarChart3, label: "Lihat Statistik", tint: "text-violet-600 bg-violet-100 dark:bg-violet-950/50 dark:text-violet-300" },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Aksi Cepat</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.label}
              href={a.href}
              className="flex flex-col items-start gap-2.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={`grid size-9 place-items-center rounded-lg ${a.tint}`}>
                <Icon className="size-4" />
              </span>
              {a.label}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
      <CardTitle className="text-base">{title}</CardTitle>
      <Button variant="ghost" size="sm" asChild className="h-8 gap-1 text-xs text-muted-foreground">
        <Link href={href}>
          {linkLabel}
          <ArrowRight className="!size-3.5" />
        </Link>
      </Button>
    </CardHeader>
  );
}

function RecentProducts({
  sid,
  products,
  loading,
}: {
  sid: string;
  products: PaginatedResult<Product> | null;
  loading: boolean;
}) {
  const items = products?.items ?? [];
  return (
    <Card>
      <SectionHeader title="Produk Terbaru" href={`/sites/${sid}/products`} linkLabel="Semua produk" />
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-12 animate-pulse rounded-md bg-muted/50" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted/50" />
                  <div className="h-3 w-1/4 animate-pulse rounded-md bg-muted/50" />
                </div>
              </div>
            ))}
          </div>
        ) : !products ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Produk belum bisa dimuat. Coba muat ulang halaman.
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Belum ada produk"
            description="Tambahkan produk pertama Anda supaya pembeli bisa mulai belanja."
            cta="Tambah Produk"
            href={`/sites/${sid}/products`}
          />
        ) : (
          <ul className="divide-y">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground/60" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-sm tabular-nums text-muted-foreground">
                    {fmtPrice(p.price, p.currency)}
                  </div>
                </div>
                {p.status !== "active" && (
                  <Badge variant="secondary" className="shrink-0">
                    {p.status === "draft" ? "Draf" : "Diarsipkan"}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentOrders({
  sid,
  orders,
  loading,
}: {
  sid: string;
  orders: OrderPage | null;
  loading: boolean;
}) {
  const items = orders?.items ?? [];
  return (
    <Card>
      <SectionHeader title="Pesanan Terbaru" href={`/sites/${sid}/orders`} linkLabel="Semua pesanan" />
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted/50" />
                  <div className="h-3 w-1/2 animate-pulse rounded-md bg-muted/50" />
                </div>
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted/50" />
              </div>
            ))}
          </div>
        ) : !orders ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Pesanan belum bisa dimuat. Coba muat ulang halaman.
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Belum ada pesanan"
            description="Pesanan dari keranjang belanja situs Anda akan muncul di sini."
            cta="Lihat Pesanan"
            ctaIcon={ArrowRight}
            href={`/sites/${sid}/orders`}
          />
        ) : (
          <ul className="divide-y">
            {items.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/sites/${sid}/orders`}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:text-primary"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold tabular-nums">{o.order_no}</span>
                      <span className="truncate text-sm">{o.customer_name || "—"}</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {timeAgo(o.created_at)} · {itemsSummary(o.items)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-medium tabular-nums">{fmtOrderTotal(o)}</span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentMessages({
  sid,
  messages,
  loading,
}: {
  sid: string;
  messages: { total: number; recent: Message[] } | null;
  loading: boolean;
}) {
  return (
    <Card>
      <SectionHeader title="Pesan Terbaru" href={`/sites/${sid}/forms`} linkLabel="Semua pesan" />
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted/50" />
                <div className="h-3 w-full animate-pulse rounded-md bg-muted/50" />
              </div>
            ))}
          </div>
        ) : !messages ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Pesan belum bisa dimuat. Coba muat ulang halaman.
          </p>
        ) : messages.recent.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Belum ada pesan masuk"
            description="Pesan dari formulir kontak di website akan muncul di sini."
            cta="Tambah Kontak"
            href={`/sites/${sid}/editor`}
          />
        ) : (
          <ul className="space-y-1">
            {messages.recent.map((m, i) => {
              const { sender, body } = messagePreview(m);
              return (
                <li key={m.id}>
                  {i > 0 && <Separator className="my-2" />}
                  <div className="flex gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials(sender)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{sender}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(m.submitted_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{body}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
  ctaIcon: CtaIcon = Plus,
  href,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  cta: string;
  ctaIcon?: React.ElementType;
  href: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed px-4 py-8 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>
      <Button size="sm" variant="outline" asChild className="mt-4">
        <Link href={href}>
          <CtaIcon />
          {cta}
        </Link>
      </Button>
    </div>
  );
}

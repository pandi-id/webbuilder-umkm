"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Clock,
  Receipt,
  RefreshCw,
  Search,
  SortAsc,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  errMessage,
  getOrder,
  getOrderSummary,
  listOrders,
  updateOrderStatus,
  type Order,
  type OrderPage,
  type OrderSort,
  type OrderStatus,
  type OrderSummary,
} from "@/lib/api";
import { Pagination, useDebounced } from "@/components/Pagination";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import {
  ORDER_STATUS_META,
  fmtDateTime,
  fmtOrderTotal,
  formatWa,
  itemsSummary,
  waHref,
} from "@/components/orders/utils";
import {
  emitOrdersSummary,
  fmtNumber,
  fmtPrice,
  timeAgo,
} from "@/components/site-dashboard/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CancelOrderDialog, OrderDetailDialog, StatusActions } from "./OrderDialogs";
import { WhatsappCard } from "./WhatsappCard";

const PAGE_SIZE = 20;
const REFRESH_MS = 30_000;

const SORT_OPTIONS: { value: OrderSort; label: string }[] = [
  { value: "newest", label: "Terbaru" },
  { value: "oldest", label: "Terlama" },
  { value: "total_desc", label: "Total Terbesar" },
];

type StatusFilter = "all" | OrderStatus;
const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "new", label: "Baru" },
  { value: "processing", label: "Diproses" },
  { value: "done", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

const TILE_TINT: Record<OrderStatus, string> = {
  new: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
};
const TILE_ICON: Record<OrderStatus, React.ElementType> = {
  new: CircleDot,
  processing: Clock,
  done: CheckCircle2,
  cancelled: XCircle,
};

// Runs `fn` every `ms` only while the tab is visible, and once on return to the
// tab so a seller switching back from WhatsApp sees fresh orders immediately.
function useVisibleInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id === null) id = setInterval(() => ref.current(), ms);
    };
    const stop = () => {
      if (id !== null) clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        ref.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
}

export default function OrdersPage() {
  const params = useParams<{ id: string }>();
  const sid = params.id;

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<OrderSort>("newest");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q.trim(), 300);

  const [data, setData] = useState<OrderPage | null>(null);
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<Order | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, sort, status]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await getOrderSummary(sid);
      setSummary(s);
      emitOrdersSummary(sid, s.new ?? 0);
    } catch {
      // Tiles fall back to "—"; the list error banner already explains failures.
    }
  }, [sid]);

  // `silent` skips the dim state so background polling doesn't flicker the table.
  const loadList = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const r = await listOrders(sid, {
          page,
          pageSize: PAGE_SIZE,
          q: debouncedQ,
          status: status === "all" ? "" : status,
          sort,
        });
        setData(r);
        setErr(null);
      } catch (e) {
        if (!silent) {
          setErr(
            e instanceof ApiError && e.status === 404
              ? "Fitur pesanan belum tersedia di server. Coba lagi nanti."
              : errMessage(e),
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sid, page, debouncedQ, status, sort],
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const pollAll = useCallback(() => {
    loadList(true);
    loadSummary();
  }, [loadList, loadSummary]);
  useVisibleInterval(pollAll, REFRESH_MS);

  function openDetail(o: Order) {
    setSelected(o);
    setDetailOpen(true);
    // Refresh in the background in case the row is up to 30s stale.
    getOrder(o.id)
      .then((fresh) => setSelected((cur) => (cur && cur.id === fresh.id ? fresh : cur)))
      .catch(() => {});
  }

  function requestStatus(o: Order, to: OrderStatus) {
    if (to === "cancelled") {
      setCancelTarget(o);
      return;
    }
    void applyStatus(o, to);
  }

  async function applyStatus(o: Order, to: OrderStatus) {
    setBusyId(o.id);
    try {
      const updated = await updateOrderStatus(o.id, to);
      const merged: Order = { ...o, ...updated, status: updated?.status ?? to };
      setData((prev) =>
        prev ? { ...prev, items: prev.items.map((x) => (x.id === o.id ? merged : x)) } : prev,
      );
      setSelected((cur) => (cur && cur.id === o.id ? merged : cur));
      toast.success(
        to === "cancelled"
          ? `Pesanan ${o.order_no} dibatalkan. Stok produk dikembalikan.`
          : `Pesanan ${o.order_no} ditandai ${ORDER_STATUS_META[to].label.toLowerCase()}.`,
      );
      setCancelTarget(null);
      // Re-fetch so filtered tabs drop the row and counts stay exact.
      loadList(true);
      loadSummary();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.code === "invalid_transition")) {
        toast.error("Status pesanan sudah berubah. Data dimuat ulang.");
        setCancelTarget(null);
        loadList(true);
        loadSummary();
        getOrder(o.id)
          .then((fresh) => setSelected((cur) => (cur && cur.id === fresh.id ? fresh : cur)))
          .catch(() => {});
      } else {
        toast.error(errMessage(e, "Gagal mengubah status"));
      }
    } finally {
      setBusyId(null);
    }
  }

  const orders = data?.items ?? [];
  const totalAll = summary
    ? summary.new + summary.processing + summary.done + summary.cancelled
    : null;
  const countFor = (s: StatusFilter): number | null =>
    !summary ? null : s === "all" ? totalAll : summary[s];

  const statusLabel = STATUS_TABS.find((t) => t.value === status)?.label ?? "";
  const emptyTitle = debouncedQ
    ? `Tidak ada hasil untuk "${debouncedQ}"`
    : status !== "all"
      ? `Tidak ada pesanan berstatus ${statusLabel}`
      : "Belum ada pesanan";
  const emptyBody = debouncedQ
    ? "Coba kata kunci lain: nama pembeli, nomor WhatsApp, atau nomor pesanan."
    : status !== "all"
      ? "Pilih tab Semua untuk melihat pesanan lainnya."
      : "Pesanan dari keranjang belanja situs Anda akan muncul di sini.";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <Receipt className="size-4 text-primary" />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Keranjang Belanja
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Pesanan</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Diperbarui otomatis setiap 30 detik selama halaman ini terbuka.
          </p>
        </div>
        <Button variant="outline" onClick={() => pollAll()} className="gap-2">
          <RefreshCw className="size-4" />
          Muat Ulang
        </Button>
      </div>

      <WhatsappCard siteId={sid} />

      {/* Summary tiles — clicking one filters the list. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(["new", "processing", "done", "cancelled"] as OrderStatus[]).map((s) => {
          const Icon = TILE_ICON[s];
          const active = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(active ? "all" : s)}
              aria-pressed={active}
              className="text-left focus-visible:outline-none"
            >
              <Card
                className={cn(
                  "h-full p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
                  active && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("grid size-8 place-items-center rounded-lg", TILE_TINT[s])}>
                    <Icon className="size-4" />
                  </span>
                  <span className="text-sm text-muted-foreground">{ORDER_STATUS_META[s].label}</span>
                </div>
                {summary ? (
                  <div className="mt-2 text-2xl font-bold tabular-nums">{fmtNumber(summary[s])}</div>
                ) : (
                  <div className="mt-2 h-8 w-12 animate-pulse rounded-md bg-muted/50" />
                )}
              </Card>
            </button>
          );
        })}
        <Card className="col-span-2 p-4 sm:col-span-1">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Wallet className="size-4" />
            </span>
            <span className="text-sm text-muted-foreground">Pendapatan (Selesai)</span>
          </div>
          {summary ? (
            <div className="mt-2 truncate text-2xl font-bold tabular-nums" title={fmtPrice(summary.revenue_done)}>
              {fmtPrice(summary.revenue_done)}
            </div>
          ) : (
            <div className="mt-2 h-8 w-28 animate-pulse rounded-md bg-muted/50" />
          )}
        </Card>
      </div>

      {/* Toolbar */}
      <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:px-4">
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-auto">
            {STATUS_TABS.map((t) => {
              const n = countFor(t.value);
              return (
                <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                  {t.label}
                  {n !== null && (
                    <span className="rounded-full bg-background/70 px-1.5 text-[11px] tabular-nums text-muted-foreground">
                      {fmtNumber(n)}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama, nomor WA, atau #0042…"
              className="h-9 border-transparent bg-muted/40 pl-9 transition-colors focus:border-input focus:bg-background"
              aria-label="Cari pesanan"
            />
          </div>
          <div className="flex items-center gap-2">
            <SortAsc className="size-4 shrink-0 text-muted-foreground" />
            <Select value={sort} onValueChange={(v) => setSort(v as OrderSort)}>
              <SelectTrigger className="h-9 w-full border-transparent bg-muted/40 focus:border-input sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>
            <span className="font-medium">Gagal memuat:</span> {err}
          </span>
        </div>
      )}

      <Card className="overflow-hidden rounded-xl p-0 shadow-sm">
        {loading && !data ? (
          <ListSkeleton />
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Receipt className="size-6 text-muted-foreground" />
            </div>
            <p className="mt-2 text-sm font-medium">{emptyTitle}</p>
            <p className="max-w-sm text-xs text-muted-foreground">{emptyBody}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="pl-5 font-semibold text-foreground">No. Pesanan</TableHead>
                    <TableHead className="font-semibold text-foreground">Pembeli</TableHead>
                    <TableHead className="font-semibold text-foreground">Barang</TableHead>
                    <TableHead className="text-right font-semibold text-foreground">Total</TableHead>
                    <TableHead className="font-semibold text-foreground">Status</TableHead>
                    <TableHead className="pr-5 text-right font-semibold text-foreground">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={loading ? "opacity-60" : ""}>
                  {orders.map((o) => (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer"
                      onClick={() => openDetail(o)}
                    >
                      <TableCell className="pl-5 align-top">
                        <button
                          type="button"
                          className="font-semibold tabular-nums hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(o);
                          }}
                        >
                          {o.order_no}
                        </button>
                        <div className="text-xs text-muted-foreground" title={fmtDateTime(o.created_at)}>
                          {timeAgo(o.created_at)}
                        </div>
                        <div className="text-[11px] text-muted-foreground/80">{fmtDateTime(o.created_at)}</div>
                      </TableCell>
                      <TableCell className="max-w-[200px] align-top">
                        <div className="truncate font-medium">{o.customer_name || "—"}</div>
                        {o.customer_phone ? (
                          <a
                            href={waHref(o.customer_phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs tabular-nums text-primary hover:underline"
                          >
                            {formatWa(o.customer_phone)}
                          </a>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[240px] align-top">
                        <div className="truncate text-sm text-muted-foreground" title={itemsSummary(o.items)}>
                          {itemsSummary(o.items)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right align-top font-medium tabular-nums">
                        {fmtOrderTotal(o)}
                      </TableCell>
                      <TableCell className="align-top">
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell className="pr-5 align-top">
                        <StatusActions
                          order={o}
                          busy={busyId === o.id}
                          onRequest={requestStatus}
                          className="flex flex-wrap items-center justify-end gap-1"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <ul className={cn("divide-y md:hidden", loading && "opacity-60")}>
              {orders.map((o) => (
                <li key={o.id} className="space-y-2.5 p-4">
                  <button
                    type="button"
                    onClick={() => openDetail(o)}
                    className="block w-full space-y-2 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold tabular-nums">{o.order_no}</div>
                        <div className="text-xs text-muted-foreground" title={fmtDateTime(o.created_at)}>
                          {timeAgo(o.created_at)} · {fmtDateTime(o.created_at)}
                        </div>
                      </div>
                      <OrderStatusBadge status={o.status} />
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{o.customer_name || "—"}</span>
                      <span className="text-muted-foreground"> · {itemsSummary(o.items)}</span>
                    </div>
                    <div className="text-base font-bold tabular-nums">{fmtOrderTotal(o)}</div>
                  </button>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {o.customer_phone ? (
                      <a
                        href={waHref(o.customer_phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium tabular-nums text-primary hover:underline"
                      >
                        WA {formatWa(o.customer_phone)}
                      </a>
                    ) : (
                      <span />
                    )}
                    <StatusActions order={o} busy={busyId === o.id} onRequest={requestStatus} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {data && data.total_pages > 1 && (
          <div className="border-t">
            <Pagination
              page={data.page}
              totalPages={data.total_pages}
              total={data.total}
              pageSize={data.page_size}
              onPage={setPage}
            />
          </div>
        )}
      </Card>

      <OrderDetailDialog
        order={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        busy={!!selected && busyId === selected.id}
        onRequestStatus={requestStatus}
      />
      <CancelOrderDialog
        order={cancelTarget}
        busy={!!cancelTarget && busyId === cancelTarget.id}
        onOpenChange={(open) => {
          if (!open && !busyId) setCancelTarget(null);
        }}
        onConfirm={() => cancelTarget && applyStatus(cancelTarget, "cancelled")}
      />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="space-y-2">
            <div className="h-4 w-16 animate-pulse rounded-md bg-muted/50" />
            <div className="h-3 w-24 animate-pulse rounded-md bg-muted/50" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted/50" />
            <div className="h-3 w-1/2 animate-pulse rounded-md bg-muted/50" />
          </div>
          <div className="hidden h-5 w-20 animate-pulse rounded-full bg-muted/50 sm:block" />
        </div>
      ))}
    </div>
  );
}

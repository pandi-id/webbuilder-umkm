"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ShoppingBag,
  Plus,
  Search,
  SortAsc,
  Package,
  Tag,
  ImageIcon,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  Archive,
  AlertCircle,
  Loader2,
  Infinity as InfinityIcon,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  Pagination,
  useDebounced,
  type PaginatedResult,
} from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
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
import { type Product } from "./ProductForm";

const SORT_OPTIONS = [
  { value: "newest", label: "Terbaru Dibuat" },
  { value: "oldest", label: "Terlama" },
  { value: "name_asc", label: "Nama A → Z" },
  { value: "price_desc", label: "Harga Termahal" },
  { value: "price_asc", label: "Harga Termurah" },
];

const STATUS_OPTIONS = [
  { value: "_all", label: "Semua Status" },
  { value: "active", label: "Aktif" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Arsip" },
];

const STATUS_CFG: Record<
  string,
  { label: string; icon: React.ElementType; class: string }
> = {
  active: {
    label: "Aktif",
    icon: CheckCircle2,
    class:
      "bg-emerald-500/10 text-emerald-700 border-emerald-200 dark:text-emerald-400",
  },
  draft: {
    label: "Draft",
    icon: Clock,
    class: "bg-muted text-muted-foreground border-border",
  },
  archived: {
    label: "Arsip",
    icon: Archive,
    class: "bg-muted/60 text-muted-foreground border-border",
  },
};

function SkeletonRow() {
  return (
    <TableRow className="animate-pulse">
      <TableCell className="pl-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-md bg-muted" />
          <div className="space-y-1.5">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="h-3 w-24 rounded bg-muted" />
      </TableCell>
      <TableCell>
        <div className="h-4 w-24 rounded bg-muted" />
      </TableCell>
      <TableCell>
        <div className="h-3 w-10 rounded bg-muted" />
      </TableCell>
      <TableCell>
        <div className="h-5 w-20 rounded-full bg-muted" />
      </TableCell>
      <TableCell className="pr-5">
        <div className="ml-auto h-8 w-24 rounded bg-muted" />
      </TableCell>
    </TableRow>
  );
}

function formatPrice(price: number, currency: string) {
  if (currency === "IDR") return `Rp ${price.toLocaleString("id-ID")}`;
  return `${currency} ${price.toLocaleString("id-ID")}`;
}

export default function ProductsPage() {
  const params = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("newest");
  const [status, setStatus] = useState<string>("_all");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 300);
  const [data, setData] = useState<PaginatedResult<Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, sort, status]);

  async function refresh() {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page: String(page),
        page_size: "20",
        sort,
      });
      if (debouncedQ) p.set("q", debouncedQ);
      if (status !== "_all") p.set("status", status);
      const r = await api<PaginatedResult<Product>>(
        `/api/v1/sites/${params.id}/products?${p}`,
      );
      setData(r);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [params.id, page, debouncedQ, sort, status]);

  async function remove(p: Product) {
    if (!confirm(`Hapus produk "${p.name}"?\n\nTindakan ini tidak dapat dibatalkan.`))
      return;
    setActionLoading(`delete-${p.id}`);
    try {
      await api(`/api/v1/products/${p.id}`, { method: "DELETE" });
      toast.success(`Produk "${p.name}" dihapus.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  const products = data?.items ?? [];
  const activeCount = products.filter((p) => p.status === "active").length;
  const lowStock = products.filter(
    (p) => p.stock !== null && p.stock !== undefined && p.stock <= 5 && p.stock > 0,
  ).length;
  const outOfStock = products.filter(
    (p) => p.stock !== null && p.stock !== undefined && p.stock === 0,
  ).length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10">
              <ShoppingBag className="size-4 text-amber-600" />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Manajemen Produk
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Produk</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data
              ? `${data.total} produk${activeCount > 0 ? ` · ${activeCount} aktif di halaman ini` : ""}`
              : "Memuat data…"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Inline stat chips */}
          {data && (
            <>
              <div className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-sm">
                <Package className="size-3.5 text-muted-foreground" />
                <span className="font-semibold">{data.total}</span>
                <span className="text-muted-foreground">total</span>
              </div>
              {outOfStock > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-500/10 px-3 py-1.5 text-sm shadow-sm dark:border-red-900 dark:bg-red-500/10">
                  <AlertTriangle className="size-3.5 text-red-600" />
                  <span className="font-semibold text-red-700 dark:text-red-400">
                    {outOfStock}
                  </span>
                  <span className="text-red-700/80 dark:text-red-400/80">habis</span>
                </div>
              )}
              {lowStock > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-500/10 px-3 py-1.5 text-sm shadow-sm dark:border-amber-900 dark:bg-amber-500/10">
                  <AlertTriangle className="size-3.5 text-amber-600" />
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {lowStock}
                  </span>
                  <span className="text-amber-700/80 dark:text-amber-400/80">low stock</span>
                </div>
              )}
            </>
          )}

          <Button asChild className="gap-2 shadow-sm">
            <Link href={`/sites/${params.id}/products/new`}>
              <Plus className="size-4" />
              Produk Baru
            </Link>
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau slug produk…"
            className="h-9 border-transparent bg-muted/40 pl-9 transition-colors focus:border-input focus:bg-background"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-40 border-transparent bg-muted/40 focus:border-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SortAsc className="size-4 text-muted-foreground" />
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-48 border-transparent bg-muted/40 focus:border-input">
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

      {/* Error */}
      {err && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>
            <span className="font-medium">Gagal memuat:</span> {err}
          </span>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden rounded-xl p-0 shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="pl-5 font-semibold text-foreground">
                <div className="flex items-center gap-1.5">
                  <Package className="size-3.5" />
                  Produk
                </div>
              </TableHead>
              <TableHead className="font-semibold text-foreground">
                <div className="flex items-center gap-1.5">
                  <Tag className="size-3.5" />
                  Slug
                </div>
              </TableHead>
              <TableHead className="font-semibold text-foreground">Harga</TableHead>
              <TableHead className="font-semibold text-foreground">Stok</TableHead>
              <TableHead className="font-semibold text-foreground">Status</TableHead>
              <TableHead className="pr-5 text-right font-semibold text-foreground">
                Aksi
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && products.length === 0 ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                      <ShoppingBag className="size-6 text-muted-foreground" />
                    </div>
                    <p className="mt-2 text-sm font-medium">
                      {debouncedQ
                        ? `Tidak ada hasil untuk "${debouncedQ}"`
                        : "Belum ada produk"}
                    </p>
                    {!debouncedQ && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Tambah produk pertama untuk mulai berjualan.
                        </p>
                        <Button asChild className="mt-3 gap-2 shadow-sm">
                          <Link href={`/sites/${params.id}/products/new`}>
                            <Plus className="size-4" />
                            Tambah Produk
                          </Link>
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              products.map((p) => {
                const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.draft;
                const Icon = cfg.icon;
                const stockNum = p.stock;
                const isUnlimited = stockNum === null || stockNum === undefined;
                const isOut = !isUnlimited && stockNum === 0;
                const isLow = !isUnlimited && stockNum != null && stockNum > 0 && stockNum <= 5;
                return (
                  <TableRow key={p.id} className="group transition-colors">
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.image_url}
                            alt={p.name}
                            className="size-12 shrink-0 rounded-md border object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted">
                            <ImageIcon className="size-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/sites/${params.id}/products/${p.id}/edit`}
                            className="block truncate text-left font-medium hover:text-primary"
                          >
                            {p.name}
                          </Link>
                          {p.category ? (
                            <Badge
                              variant="secondary"
                              className="mt-1 px-1.5 py-0 text-[10px] font-normal"
                            >
                              {p.category}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
                      /{p.slug}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">
                      {formatPrice(p.price, p.currency)}
                    </TableCell>
                    <TableCell>
                      {isUnlimited ? (
                        <span
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
                          title="Stok tak terbatas"
                        >
                          <InfinityIcon className="size-3.5" />
                        </span>
                      ) : isOut ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                          <AlertTriangle className="size-3" />
                          Habis
                        </span>
                      ) : isLow ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="size-3" />
                          {stockNum} tersisa
                        </span>
                      ) : (
                        <span className="tabular-nums text-sm">{stockNum}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1 ${cfg.class}`}>
                        <Icon className="size-3" />
                        {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="h-8 gap-1.5"
                          title="Edit"
                        >
                          <Link href={`/sites/${params.id}/products/${p.id}/edit`}>
                            <Pencil className="size-3.5" />
                            <span className="hidden sm:inline">Edit</span>
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(p)}
                          disabled={actionLoading === `delete-${p.id}`}
                          className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          title="Hapus"
                        >
                          {actionLoading === `delete-${p.id}` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

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
    </div>
  );
}

"use client";

// Admin observability untuk domain aktif lintas user — aggregate view
// dari tabel `registered_domains` (1 row per FQDN).
//
// Use case:
//   - Cari domain X → filter by nama / owner email
//   - "Berapa domain expire dalam 30 hari?" → filter expiring_days=30
//   - Lihat siapa owner, kapan register, kapan renew terakhir
//
// Read-only: mutasi (register, renew, transfer) tetap dari sisi user.
// Untuk riwayat transaksi register + renew per event → /admin/domain/purchases.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Globe2,
  Search,
  CalendarDays,
  Download,
  Loader2,
  AlertCircle,
  RefreshCw,
  Mail,
  ExternalLink,
  ListChecks,
  CalendarClock,
  Unlink,
  LayoutTemplate,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { api, downloadFile } from "@/lib/api";
import { Pagination, useDebounced, type PaginatedResult } from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

type Row = {
  name: string;
  status: string;
  contact_id?: string;
  expires_at?: string;
  registered_at: string;
  last_renewed_at?: string;
  site_id?: string | null;
  registrar_job_id?: string;
  user_id: string;
  user_email: string;
  user_name: string;
  purchased_by?: string | null;
};

type Stats = {
  total_active: number;
  active_without_site: number;
};

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "active", label: "Aktif" },
  { value: "expired", label: "Kadaluwarsa" },
  { value: "suspended", label: "Suspended" },
];

// Filter expire — semantic "dalam N hari ke depan". 0 = semua.
const EXPIRING_OPTIONS = [
  { value: "all", label: "Semua expiry" },
  { value: "7", label: "≤ 7 hari" },
  { value: "30", label: "≤ 30 hari" },
  { value: "90", label: "≤ 90 hari" },
];

function statusVariant(s: string): "success" | "destructive" | "secondary" {
  if (s === "active") return "success";
  if (s === "expired" || s === "suspended") return "destructive";
  return "secondary";
}

function statusLabel(s: string): string {
  const found = STATUS_OPTIONS.find((o) => o.value === s);
  return found?.label ?? s;
}

export default function AdminDomainsPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 300);
  const [status, setStatus] = useState("all");
  const [expiring, setExpiring] = useState("all");
  const [withoutSite, setWithoutSite] = useState(false);
  // Rentang tanggal pendaftaran (kolom "Terdaftar"), inklusif di kedua ujung.
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);

  const [data, setData] = useState<PaginatedResult<Row> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, expiring, withoutSite, createdFrom, createdTo]);

  // Stats tidak ikut filter — angkanya total platform, fetch sekali saja.
  useEffect(() => {
    let cancelled = false;
    api<Stats>("/api/v1/admin/domains/stats")
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch(() => {
        /* kartu stats opsional — jangan blok tabel kalau gagal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setErr(null);
      const params = filterParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      try {
        const res = await api<PaginatedResult<Row>>(
          `/api/v1/admin/domains?${params.toString()}`,
        );
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, debouncedQ, status, expiring, withoutSite, createdFrom, createdTo]);

  const items = data?.items ?? [];
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (debouncedQ) n++;
    if (status !== "all") n++;
    if (expiring !== "all") n++;
    if (withoutSite) n++;
    if (createdFrom || createdTo) n++;
    return n;
  }, [debouncedQ, status, expiring, withoutSite, createdFrom, createdTo]);

  function clearFilters() {
    setQ("");
    setStatus("all");
    setExpiring("all");
    setWithoutSite(false);
    setCreatedFrom("");
    setCreatedTo("");
  }

  // One place builds the filter query, so the CSV always describes exactly the
  // rows on screen.
  function filterParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (status !== "all") p.set("status", status);
    if (expiring !== "all") p.set("expiring_days", expiring);
    if (withoutSite) p.set("without_site", "true");
    if (createdFrom) p.set("created_from", createdFrom);
    if (createdTo) p.set("created_to", createdTo);
    return p;
  }

  async function exportCSV() {
    setExporting(true);
    try {
      const res = await downloadFile(
        `/api/v1/admin/domains.csv?${filterParams()}`,
        `domains-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      if (res.truncated) {
        toast.warning(
          `Export dibatasi 10.000 baris dari ${res.totalRows?.toLocaleString("id-ID")} hasil.`,
          { description: "Persempit filter untuk mendapatkan sisanya." },
        );
      } else {
        toast.success("CSV diunduh");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  // Kartu "tanpa situs" sekaligus jadi toggle filter tabel di bawahnya —
  // klik = langsung lihat domain mana saja yang dimaksud.
  function toggleWithoutSite() {
    const next = !withoutSite;
    setWithoutSite(next);
    if (next) setStatus("active");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <Globe2 className="size-4 text-primary" />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Ops Observability
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Domain Aktif</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Semua domain yang di-register via web builder — aggregate view (1 baris
            per FQDN). Untuk riwayat transaksi register + renew per event, lihat
            <Link
              href="/admin/domain/purchases"
              className="ml-1 text-primary underline-offset-4 hover:underline"
            >
              Riwayat Transaksi
            </Link>
            .
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href="/admin/domain/purchases">
            <ListChecks className="size-3.5" />
            Riwayat Transaksi
          </Link>
        </Button>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-start justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Domain Aktif
              </span>
              <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Globe2 className="size-4" />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums tracking-tight">
              {stats ? stats.total_active.toLocaleString("id-ID") : "—"}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Status aktif di seluruh platform
            </p>
          </CardContent>
        </Card>

        <Card
          className={
            "transition-colors " +
            (withoutSite ? "border-amber-500 ring-1 ring-amber-500/30" : "")
          }
        >
          <CardContent className="p-5">
            <div className="mb-3 flex items-start justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Aktif Tanpa Situs
              </span>
              <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Unlink className="size-4" />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums tracking-tight">
              {stats ? stats.active_without_site.toLocaleString("id-ID") : "—"}
            </p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Sudah dibeli, belum dipakai bikin situs
              </p>
              {stats !== null && stats.active_without_site > 0 && (
                <Button
                  variant={withoutSite ? "secondary" : "outline"}
                  size="sm"
                  onClick={toggleWithoutSite}
                  className="h-7 shrink-0 gap-1 text-xs"
                >
                  {withoutSite ? "Tutup" : "Lihat detail"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari domain, email, atau nama owner…"
              className="h-9 pl-8"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[170px]">
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
          <Select value={expiring} onValueChange={setExpiring}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={withoutSite ? "secondary" : "outline"}
            size="sm"
            onClick={toggleWithoutSite}
            className="h-9 gap-1.5"
            title="Tampilkan hanya domain aktif yang belum punya situs"
          >
            <Unlink className="size-3.5" />
            Tanpa situs
          </Button>
          {/* Rentang tanggal pendaftaran — inklusif di kedua ujung. */}
          <div className="flex items-center gap-1.5">
            <CalendarDays
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="date"
              value={createdFrom}
              max={createdTo || undefined}
              onChange={(e) => setCreatedFrom(e.target.value)}
              aria-label="Terdaftar dari tanggal"
              title="Terdaftar dari tanggal"
              className="h-9 w-[150px]"
            />
            <span className="text-xs text-muted-foreground">s/d</span>
            <Input
              type="date"
              value={createdTo}
              min={createdFrom || undefined}
              onChange={(e) => setCreatedTo(e.target.value)}
              aria-label="Terdaftar sampai tanggal"
              title="Terdaftar sampai tanggal"
              className="h-9 w-[150px]"
            />
          </div>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Reset ({activeFilterCount})
            </Button>
          )}
          {/* Export mengikuti filter yang sedang aktif, bukan halaman ini saja. */}
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={exporting || !data || data.total === 0}
            className="ml-auto h-9 gap-1.5"
            title="Unduh hasil filter saat ini sebagai CSV"
          >
            {exporting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Export CSV
          </Button>
        </div>

        <div className={loading ? "opacity-60" : ""}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Situs</TableHead>
                <TableHead>Contact ID</TableHead>
                <TableHead>Expire</TableHead>
                <TableHead>Terdaftar</TableHead>
                <TableHead className="w-0"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Memuat…
                    </span>
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    {withoutSite
                      ? "Semua domain aktif sudah punya situs."
                      : activeFilterCount > 0
                        ? "Tidak ada hasil untuk filter tersebut."
                        : "Belum ada domain — user belum register apapun."}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => {
                  const expInfo = formatExpiry(r.expires_at);
                  return (
                    <TableRow key={r.name}>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`https://${r.name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Buka https://${r.name}`}
                            className="text-sm font-medium underline-offset-4 transition-colors hover:text-primary hover:underline"
                          >
                            <code>{r.name}</code>
                          </a>
                          <CopyButton value={r.name} />
                        </div>
                        {r.last_renewed_at && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            renew terakhir {formatDate(r.last_renewed_at)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {r.user_name || "—"}
                          </span>
                          <a
                            href={`mailto:${r.user_email}`}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Mail className="size-3" />
                            {r.user_email}
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant={statusVariant(r.status)} className="text-xs">
                          {statusLabel(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        {r.site_id ? (
                          <Link
                            href={`/sites/${r.site_id}/editor`}
                            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                            title="Buka editor situs (admin view)"
                          >
                            <LayoutTemplate className="size-3" />
                            Ada situs
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <Unlink className="size-3" />
                            Belum ada
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <code className="text-[11px] text-muted-foreground">
                          {r.contact_id || "—"}
                        </code>
                      </TableCell>
                      <TableCell className="align-top text-xs">
                        {expInfo ? (
                          <span
                            className={
                              "inline-flex items-center gap-1 " +
                              (expInfo.urgent ? "text-destructive" : "text-muted-foreground")
                            }
                          >
                            <CalendarClock className="size-3" />
                            {expInfo.label}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground">
                        {formatDate(r.registered_at)}
                      </TableCell>
                      <TableCell className="align-top">
                        <Link
                          href={`/admin/domain/${encodeURIComponent(r.name)}`}
                          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                          title="Buka detail domain (admin view)"
                        >
                          Detail
                          <ExternalLink className="size-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {data && (
          <Pagination
            page={data.page}
            totalPages={data.total_pages}
            total={data.total}
            pageSize={data.page_size}
            onPage={setPage}
          />
        )}
      </Card>
    </div>
  );
}

// CopyButton — ikon salin di samping nama domain. Pakai state lokal supaya
// admin dapat konfirmasi visual langsung, tidak cuma toast yang bisa kelewat.
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Nama domain disalin");
    } catch {
      // clipboard API butuh secure context — jangan klaim sukses kalau gagal.
      toast.error("Gagal menyalin — salin manual dari kolom domain.");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Salin ${value}`}
      title="Salin nama domain"
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// formatExpiry — human-readable relative + absolute. urgent kalau < 30 hari.
function formatExpiry(iso?: string): { label: string; urgent: boolean } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((t - now) / (24 * 60 * 60 * 1000));
  const label = new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (days < 0) return { label: `${label} (expired ${-days}h lalu)`, urgent: true };
  if (days <= 30) return { label: `${label} (${days}h lagi)`, urgent: true };
  return { label, urgent: false };
}

"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Loader2,
  MessageSquareQuote,
  Reply,
  Search,
  SortAsc,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteReview,
  listReviews,
  updateReview,
  type ProductReview,
  type ReviewPage,
  type ReviewSort,
  type ReviewStatus,
} from "@/lib/api";
import { Pagination, useDebounced } from "@/components/Pagination";
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
import { Textarea } from "@/components/ui/textarea";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "_all", label: "Semua Status" },
  { value: "pending", label: "Menunggu Moderasi" },
  { value: "published", label: "Ditayangkan" },
  { value: "rejected", label: "Ditolak" },
];

const SORT_OPTIONS: { value: ReviewSort; label: string }[] = [
  { value: "newest", label: "Terbaru" },
  { value: "oldest", label: "Terlama" },
  { value: "rating_desc", label: "Bintang Tertinggi" },
  { value: "rating_asc", label: "Bintang Terendah" },
];

const STATUS_BADGE: Record<ReviewStatus, { label: string; variant: "success" | "secondary" | "destructive" }> = {
  published: { label: "Ditayangkan", variant: "success" },
  pending: { label: "Menunggu", variant: "secondary" },
  rejected: { label: "Ditolak", variant: "destructive" },
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={
            i <= rating
              ? "size-3.5 fill-amber-400 text-amber-400"
              : "size-3.5 text-muted-foreground/30"
          }
        />
      ))}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ReviewCard({
  siteId,
  review,
  onChanged,
}: {
  siteId: string;
  review: ProductReview;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState(review.reply);
  const badge = STATUS_BADGE[review.status];

  async function setStatus(status: ReviewStatus) {
    setBusy(status);
    try {
      await updateReview(siteId, review.id, { status });
      toast.success(
        status === "published"
          ? "Ulasan ditayangkan di halaman produk"
          : status === "rejected"
            ? "Ulasan ditolak"
            : "Ulasan dikembalikan ke antrean",
      );
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveReply() {
    setBusy("reply");
    try {
      await updateReview(siteId, review.id, { reply });
      toast.success(reply.trim() ? "Balasan tersimpan" : "Balasan dihapus");
      setReplyOpen(false);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Hapus ulasan dari "${review.author_name}"?\n\nTindakan ini tidak dapat dibatalkan.`))
      return;
    setBusy("delete");
    try {
      await deleteReview(siteId, review.id);
      toast.success("Ulasan dihapus");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Stars rating={review.rating} />
            <span className="font-medium">{review.author_name}</span>
            {review.verified_buyer && (
              <Badge variant="success" className="gap-1 px-1.5 py-0 text-[10px]">
                <BadgeCheck className="size-3" />
                Pembeli terverifikasi
              </Badge>
            )}
            <Badge variant={badge.variant} className="px-1.5 py-0 text-[10px]">
              {badge.label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {review.product_name ? (
              <Link
                href={`/sites/${siteId}/products/${review.product_id}/edit`}
                className="hover:text-primary hover:underline"
              >
                {review.product_name}
              </Link>
            ) : (
              "Produk dihapus"
            )}
            {" · "}
            {formatDate(review.created_at)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {review.status !== "published" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStatus("published")}
              disabled={busy !== null}
              className="h-8 gap-1.5 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700"
            >
              {busy === "published" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Tayangkan
            </Button>
          )}
          {review.status !== "rejected" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStatus("rejected")}
              disabled={busy !== null}
              className="h-8 gap-1.5"
            >
              {busy === "rejected" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Tolak
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReplyOpen((v) => !v)}
            disabled={busy !== null}
            className="h-8 gap-1.5"
            title="Balas ulasan"
          >
            <Reply className="size-3.5" />
            <span className="hidden sm:inline">Balas</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={busy !== null}
            className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Hapus"
          >
            {busy === "delete" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {review.body && <p className="mt-3 whitespace-pre-line text-sm">{review.body}</p>}

      {review.reply && !replyOpen && (
        <div className="mt-3 rounded-lg border-l-2 border-primary bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">Balasan Anda</p>
          <p className="mt-0.5 whitespace-pre-line text-sm">{review.reply}</p>
        </div>
      )}

      {replyOpen && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Tulis balasan yang tampil di bawah ulasan ini…"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveReply} disabled={busy !== null} className="gap-1.5">
              {busy === "reply" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Simpan Balasan
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReply(review.reply);
                setReplyOpen(false);
              }}
              disabled={busy !== null}
            >
              Batal
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ReviewsPage() {
  const params = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [status, setStatus] = useState("_all");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 300);
  const [data, setData] = useState<ReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, sort, status]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await listReviews(params.id, {
        page,
        pageSize: 20,
        sort,
        q: debouncedQ,
        status: status === "_all" ? "" : (status as ReviewStatus),
      });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, page, debouncedQ, sort, status]);

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/10">
              <MessageSquareQuote className="size-4 text-sky-600" />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Suara Pembeli
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Ulasan Produk</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data ? `${data.total} ulasan` : "Memuat data…"} · Ulasan baru perlu Anda tayangkan
            dulu sebelum muncul di toko.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, isi ulasan, atau produk…"
            className="h-9 border-transparent bg-muted/40 pl-9 transition-colors focus:border-input focus:bg-background"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-48 border-transparent bg-muted/40 focus:border-input">
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
          <Select value={sort} onValueChange={(v) => setSort(v as ReviewSort)}>
            <SelectTrigger className="h-9 w-44 border-transparent bg-muted/40 focus:border-input">
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

      {err && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>
            <span className="font-medium">Gagal memuat:</span> {err}
          </span>
        </div>
      )}

      <div className={loading ? "space-y-3 opacity-60" : "space-y-3"}>
        {loading && items.length === 0 ? (
          <>
            <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
            <div className="h-28 animate-pulse rounded-xl bg-muted/50" />
          </>
        ) : items.length === 0 ? (
          <Card className="py-16">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <MessageSquareQuote className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm font-medium">
                {debouncedQ
                  ? `Tidak ada hasil untuk "${debouncedQ}"`
                  : status !== "_all"
                    ? "Tidak ada ulasan dengan status ini"
                    : "Belum ada ulasan"}
              </p>
              {!debouncedQ && status === "_all" && (
                <p className="max-w-sm text-xs text-muted-foreground">
                  Pembeli bisa memberi bintang dan ulasan langsung dari halaman produk di toko
                  Anda. Ulasan yang masuk akan muncul di sini untuk Anda setujui.
                </p>
              )}
            </div>
          </Card>
        ) : (
          items.map((r) => (
            <ReviewCard key={r.id} siteId={params.id} review={r} onChanged={refresh} />
          ))
        )}
      </div>

      {data && data.total_pages > 1 && (
        <Card className="overflow-hidden p-0">
          <Pagination
            page={data.page}
            totalPages={data.total_pages}
            total={data.total}
            pageSize={data.page_size}
            onPage={setPage}
          />
        </Card>
      )}
    </div>
  );
}

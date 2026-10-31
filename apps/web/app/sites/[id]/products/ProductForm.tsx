"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  Save,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImagePicker } from "@/components/ImagePicker";
import { RichEditor } from "@/components/RichEditor";
import { useAutoSavedAgo } from "@/lib/useAutoSavedAgo";

export type Product = {
  id: string;
  site_id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number | null;
  image_url: string;
  category: string;
  status: "active" | "draft" | "archived";
};

type Status = Product["status"];

const STATUS_META: Record<Status, { label: string; icon: React.ElementType; variant: "success" | "secondary" }> = {
  active: { label: "Aktif", icon: CheckCircle2, variant: "success" },
  draft: { label: "Draft", icon: Clock, variant: "secondary" },
  archived: { label: "Arsip", icon: Archive, variant: "secondary" },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Rupiah thousands separator for the price field. The API stores the smallest
// unit as an integer, so the separator is display-only.
function formatThousands(n: number): string {
  return n ? n.toLocaleString("id-ID") : "";
}
function parseThousands(s: string): number {
  const digits = s.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

export function ProductForm({
  siteId,
  product,
}: {
  siteId: string;
  product: Product | null;
}) {
  const router = useRouter();
  const isEdit = !!product;

  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product?.price ?? 0);
  const [currency, setCurrency] = useState(product?.currency ?? "IDR");
  const [unlimited, setUnlimited] = useState(product ? product.stock == null : true);
  const [stock, setStock] = useState(product?.stock ?? 0);
  const [imageURL, setImageURL] = useState(product?.image_url ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [status, setStatus] = useState<Status>(product?.status ?? "active");
  const [saving, setSaving] = useState<Status | null>(null);

  // Auto-derive slug from the name until the user edits it by hand.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(slugify(name));
  }, [name, slugTouched]);

  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    JSON.stringify({
      name: product?.name ?? "",
      slug: product?.slug ?? "",
      description: product?.description ?? "",
      price: product?.price ?? 0,
      currency: product?.currency ?? "IDR",
      unlimited: product ? product.stock == null : true,
      stock: product?.stock ?? 0,
      imageURL: product?.image_url ?? "",
      category: product?.category ?? "",
    }),
  );
  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        name,
        slug,
        description,
        price,
        currency,
        unlimited,
        stock,
        imageURL,
        category,
      }),
    [name, slug, description, price, currency, unlimited, stock, imageURL, category],
  );
  const dirty = currentSnapshot !== savedSnapshot;
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null);
  const autoSavedAgo = useAutoSavedAgo(lastAutoSavedAt, dirty);

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save(targetStatus: Status, opts?: { silent?: boolean }) {
    if (!name.trim()) {
      if (!opts?.silent) toast.error("Nama produk wajib diisi");
      return;
    }
    if (!slug.trim()) {
      if (!opts?.silent) toast.error("Slug wajib diisi");
      return;
    }
    setSaving(targetStatus);
    try {
      const body = {
        slug,
        name,
        description,
        price,
        currency,
        ...(unlimited ? { clear_stock: true } : { stock }),
        image_url: imageURL,
        category,
        status: targetStatus,
      };
      if (isEdit) {
        await api(`/api/v1/products/${product!.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!opts?.silent) toast.success("Produk diperbarui");
      } else {
        await api(`/api/v1/sites/${siteId}/products`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!opts?.silent) {
          toast.success(
            targetStatus === "active" ? "Produk dibuat & tayang" : "Draft produk tersimpan",
          );
        }
      }
      setStatus(targetStatus);
      setSavedSnapshot(currentSnapshot);
      setLastAutoSavedAt(Date.now());
      if (!opts?.silent) router.push(`/sites/${siteId}/products`);
    } catch (e) {
      if (!opts?.silent) toast.error((e as Error).message);
      else console.warn("autosave failed:", (e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  // Autosave only in edit mode, preserving the current status so a background
  // save never publishes a draft. 3s debounce matches the block editor.
  useEffect(() => {
    if (!isEdit) return;
    if (!dirty) return;
    if (saving) return;
    if (!name.trim() || !slug.trim()) return;
    const handle = window.setTimeout(() => {
      void save(status, { silent: true });
    }, 3000);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot, dirty, saving, isEdit, status]);

  const statusMeta = STATUS_META[status];
  const StatusIcon = statusMeta.icon;

  return (
    <div className="space-y-6">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link
                href={`/sites/${siteId}/products`}
                onClick={(e) => {
                  if (dirty && !window.confirm("Ada perubahan belum disimpan. Yakin ingin keluar?")) {
                    e.preventDefault();
                  }
                }}
              >
                <ArrowLeft />
                Kembali
              </Link>
            </Button>
            <div className="hidden h-5 w-px bg-border sm:block" />
            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10">
                <Package className="size-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">
                  {isEdit ? "Edit Produk" : "Produk Baru"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isEdit ? name || "Tanpa nama" : "Simpan sebagai draft atau langsung tayangkan"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {dirty ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200"
                title={isEdit ? "Autosave 3 detik setelah berhenti mengetik" : "Klik Simpan Draft untuk menyimpan"}
              >
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                Belum disimpan
              </span>
            ) : autoSavedAgo ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                title="Tersimpan otomatis"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Tersimpan · {autoSavedAgo}
              </span>
            ) : null}
            <Badge variant={statusMeta.variant} className="gap-1">
              <StatusIcon className="size-3" />
              {statusMeta.label}
            </Badge>
            <Button
              variant="outline"
              onClick={() => save("draft")}
              disabled={saving !== null || !dirty}
              className="gap-2"
              title={!dirty ? "Tidak ada perubahan untuk disimpan" : undefined}
            >
              {saving === "draft" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Simpan Draft
            </Button>
            <Button
              onClick={() => save("active")}
              disabled={saving !== null}
              className="gap-2 shadow-sm"
            >
              {saving === "active" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {status === "active" ? "Update" : "Tayangkan"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="space-y-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama produk…"
            className="h-auto border-0 bg-transparent px-0 text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="slug" className="shrink-0 text-muted-foreground">
              URL slug
            </Label>
            <span className="font-mono text-muted-foreground">/produk/</span>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                setSlugTouched(true);
              }}
              placeholder="auto-dari-nama"
              className="h-8 max-w-md font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Deskripsi Produk</Label>
            <p className="text-xs text-muted-foreground">
              Jelaskan bahan, ukuran, cara pakai, dan keunggulan produk. Pakai toolbar untuk
              menambah judul, daftar, tabel, atau foto.
            </p>
            <RichEditor
              value={description}
              onChange={setDescription}
              placeholder="Tulis keterangan lengkap produk di sini…"
            />
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Foto Utama</CardTitle>
            </CardHeader>
            <CardContent>
              <ImagePicker value={imageURL} onChange={setImageURL} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Harga &amp; Stok</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="price" className="text-xs">
                  Harga
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {currency === "IDR" ? "Rp" : currency}
                  </span>
                  <Input
                    id="price"
                    inputMode="numeric"
                    value={formatThousands(price)}
                    onChange={(e) => setPrice(parseThousands(e.target.value))}
                    placeholder="0"
                    className="pl-10 text-right tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="currency" className="text-xs">
                  Mata Uang
                </Label>
                <Input
                  id="currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Stok</Label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={unlimited}
                    onChange={(e) => setUnlimited(e.target.checked)}
                    className="size-4 rounded border-input"
                  />
                  Tak terbatas
                </label>
                {!unlimited && (
                  <Input
                    type="number"
                    min={0}
                    value={stock}
                    onChange={(e) => setStock(Number(e.target.value))}
                    className="tabular-nums"
                  />
                )}
                <p className="text-[11px] text-muted-foreground">
                  Stok berkurang otomatis setiap ada pesanan masuk.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Lainnya</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="status" className="text-xs">
                  Status
                </Label>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif (tampil di toko)</SelectItem>
                    <SelectItem value="draft">Draft (tidak tampil)</SelectItem>
                    <SelectItem value="archived">Arsip</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Status final ditentukan tombol Simpan/Tayangkan.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category" className="text-xs">
                  Kategori
                </Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Makanan ringan"
                />
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

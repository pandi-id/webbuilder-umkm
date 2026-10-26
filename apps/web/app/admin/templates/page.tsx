"use client";

// Admin: Template Management — list + filter + actions (create/edit/publish/
// archive/duplicate/delete). Preview → new tab ke renderer.
// Plan: plan-admin-templates.md Phase 3.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Blocks,
  Copy,
  Eye,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Undo2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/Pagination";
import { TemplatePreviewModal } from "@/components/templates/TemplatePreviewModal";
import { ThumbnailPicker } from "@/components/templates/ThumbnailPicker";

const PAGE_SIZE = 20;

type Template = {
  id: string;
  slug: string;
  category: string;
  variant: string;
  name: string;
  description: string;
  preview_url: string;
  preview_screenshot_url: string;
  status: "draft" | "published" | "archived";
  source: "builtin" | "admin";
  is_premium: boolean;
  created_at: string;
  updated_at: string;
};

type PagedResp = {
  items: Template[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

const STATUS_FILTERS = [
  { value: "", label: "Semua status" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const SOURCE_FILTERS = [
  { value: "", label: "Semua source" },
  { value: "builtin", label: "Built-in" },
  { value: "admin", label: "Custom" },
];

const RENDERER_BASE =
  process.env.NEXT_PUBLIC_RENDERER_BASE ?? "http://localhost";

export default function AdminTemplatesPage() {
  const [items, setItems] = useState<Template[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null); // id + action key

  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<Template | null>(null);
  const [previewTarget, setPreviewTarget] = useState<Template | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, sourceFilter, debouncedSearch]);

  async function refresh() {
    setLoading(true);
    setErr(null);
    const q = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (statusFilter) q.set("status", statusFilter);
    if (sourceFilter) q.set("source", sourceFilter);
    if (debouncedSearch) q.set("search", debouncedSearch);
    try {
      const res = await api<PagedResp>(`/api/v1/admin/templates?${q.toString()}`);
      setItems(res.items ?? []);
      setTotal(res.total);
      setTotalPages(res.total_pages);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, sourceFilter, debouncedSearch]);

  async function doAction(t: Template, action: "publish" | "archive" | "unpublish" | "delete") {
    const key = t.id + action;
    if (action === "delete") {
      if (t.source === "builtin") {
        toast.error("Template built-in tidak bisa dihapus. Duplicate dulu lalu edit copy-nya.");
        return;
      }
      if (!confirm(`Hapus template "${t.name}"? Tindakan ini permanen.`)) return;
    }
    if (action === "archive" && !confirm(`Arsipkan "${t.name}"? Client tidak akan lihat di wizard.`)) {
      return;
    }
    setActing(key);
    try {
      if (action === "delete") {
        await api(`/api/v1/admin/templates/${t.id}`, { method: "DELETE" });
        toast.success("Template dihapus");
      } else if (action === "publish") {
        await api(`/api/v1/admin/templates/${t.id}/publish`, { method: "POST" });
        toast.success("Template dipublish");
      } else if (action === "archive") {
        await api(`/api/v1/admin/templates/${t.id}/archive`, { method: "POST" });
        toast.success("Template diarsipkan");
      } else if (action === "unpublish") {
        // Balik ke draft — via PATCH status=draft.
        await api(`/api/v1/admin/templates/${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "draft" }),
        });
        toast.success("Template dikembalikan ke draft");
      }
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  }

  function previewURL(t: Template): string | null {
    // Preview via renderer route. Draft/archived tidak accessible (404 dari
    // backend), disable tombolnya.
    if (t.status !== "published") return null;
    return `${RENDERER_BASE}/template-preview/${encodeURIComponent(t.slug)}`;
  }

  const hasFilter = statusFilter !== "" || sourceFilter !== "" || debouncedSearch !== "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <LayoutTemplate className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Template</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Kelola template yang muncul di wizard client. Built-in dari source
            code tidak boleh dihapus (duplicate untuk fork).
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="size-4" />
          Template Baru
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    statusFilter === f.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setSourceFilter(f.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    sourceFilter === f.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau slug template…"
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString("id-ID")} template
            {hasFilter && " (dengan filter aktif)"}
          </p>
        </CardContent>
      </Card>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <span>{err}</span>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-16">Thumbnail</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loading ? "opacity-60" : ""}>
              {loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <LayoutTemplate className="size-8 opacity-30" />
                      <p className="text-sm font-medium">
                        {hasFilter ? "Tidak ada template match filter" : "Belum ada template"}
                      </p>
                      {!hasFilter && (
                        <p className="text-xs">
                          Klik <b>Template Baru</b> untuk mulai membuat.
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((t) => {
                  const pv = previewURL(t);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Thumbnail template={t} />
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.name}</p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {t.slug}
                          </p>
                          {t.description && (
                            <p className="mt-0.5 max-w-[24rem] truncate text-xs text-muted-foreground">
                              {t.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {t.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{t.variant}</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={t.status} />
                      </TableCell>
                      <TableCell>
                        {t.source === "builtin" ? (
                          <Badge variant="warning" className="gap-1 text-[10px]">
                            <Package className="size-3" />
                            Built-in
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <User className="size-3" />
                            Custom
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowActions
                          template={t}
                          previewURL={pv}
                          acting={acting}
                          onPreview={() => setPreviewTarget(t)}
                          onDuplicate={() => setDuplicateTarget(t)}
                          onAction={(a) => doAction(t, a)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {total > 0 && (
        <div className={cn("rounded-md border bg-card", loading && "opacity-60")}>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPage={(n) => setPage(n)}
          />
        </div>
      )}

      <CreateTemplateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />

      <DuplicateTemplateDialog
        target={duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
        onDuplicated={() => {
          setDuplicateTarget(null);
          refresh();
        }}
      />

      {/* Live preview modal — iframe ke renderer + device switcher. Admin
          view-only (tidak ada tombol "Pakai template ini" — hanya untuk QA). */}
      <TemplatePreviewModal
        open={previewTarget !== null}
        slug={previewTarget?.slug ?? ""}
        name={previewTarget?.name ?? ""}
        description={previewTarget?.description}
        onClose={() => setPreviewTarget(null)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: "draft" | "published" | "archived" }) {
  const map = {
    draft: { label: "Draft", variant: "warning" as const },
    published: { label: "Published", variant: "success" as const },
    archived: { label: "Archived", variant: "secondary" as const },
  };
  const cfg = map[status];
  return (
    <Badge variant={cfg.variant} className="text-xs">
      {cfg.label}
    </Badge>
  );
}

function Thumbnail({ template }: { template: Template }) {
  const src = template.preview_screenshot_url || template.preview_url;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={template.name}
        className="h-12 w-16 rounded border object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <div className="flex h-12 w-16 items-center justify-center rounded border bg-muted">
      <Blocks className="size-4 text-muted-foreground" />
    </div>
  );
}

// Row-level action menu — kompak (1 trigger) supaya kolom Aksi tidak
// memanjang keluar viewport. Semua tindakan tetap satu klik dari trigger.
function RowActions({
  template,
  previewURL,
  acting,
  onPreview,
  onDuplicate,
  onAction,
}: {
  template: Template;
  previewURL: string | null;
  acting: string | null;
  onPreview: () => void;
  onDuplicate: () => void;
  onAction: (a: "publish" | "archive" | "unpublish" | "delete") => void;
}) {
  const isBuiltin = template.source === "builtin";
  const busyPublish = acting === template.id + "publish";
  const busyArchive = acting === template.id + "archive";
  const busyDelete = acting === template.id + "delete";
  const anyBusy = busyPublish || busyArchive || busyDelete;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label="Aksi template"
          disabled={anyBusy}
        >
          {anyBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          disabled={!previewURL}
          onSelect={(e) => {
            if (!previewURL) {
              e.preventDefault();
              return;
            }
            onPreview();
          }}
        >
          <Eye className="size-3.5" />
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/admin/templates/${template.id}`}>
            <Pencil className="size-3.5" />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDuplicate()}>
          <Copy className="size-3.5" />
          Duplicate
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {template.status === "draft" && (
          <DropdownMenuItem
            onSelect={() => onAction("publish")}
            className="text-emerald-600 focus:bg-emerald-50 focus:text-emerald-700 dark:focus:bg-emerald-500/10"
          >
            <Send className="size-3.5" />
            Publish
          </DropdownMenuItem>
        )}
        {template.status === "published" && (
          <DropdownMenuItem onSelect={() => onAction("archive")}>
            <Undo2 className="size-3.5" />
            Archive
          </DropdownMenuItem>
        )}
        {template.status === "archived" && (
          <DropdownMenuItem
            onSelect={() => onAction("publish")}
            className="text-emerald-600 focus:bg-emerald-50 focus:text-emerald-700 dark:focus:bg-emerald-500/10"
          >
            <Send className="size-3.5" />
            Republish
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          disabled={isBuiltin}
          onSelect={(e) => {
            if (isBuiltin) {
              e.preventDefault();
              return;
            }
            onAction("delete");
          }}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Hapus
          {isBuiltin && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              built-in
            </span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// -------- Create dialog --------

function CreateTemplateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    category: "umkm",
    variant: "modern",
    preview_url: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      slug: "",
      name: "",
      description: "",
      category: "umkm",
      variant: "modern",
      preview_url: "",
    });
    setErr(null);
  }, [open]);

  async function submit() {
    setErr(null);
    const slug = form.slug.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
      setErr("Slug harus huruf kecil, angka, hyphen, 2-40 karakter, tidak boleh leading/trailing hyphen");
      return;
    }
    if (!form.name.trim()) {
      setErr("Nama wajib diisi");
      return;
    }
    setSaving(true);
    try {
      await api("/api/v1/admin/templates", {
        method: "POST",
        body: JSON.stringify({
          slug,
          name: form.name.trim(),
          description: form.description.trim(),
          category: form.category,
          variant: form.variant,
          preview_url: form.preview_url.trim(),
          theme: {},
          pages: [],
        }),
      });
      toast.success("Template dibuat sebagai draft. Edit isi di halaman detail.");
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Template Baru</DialogTitle>
          <DialogDescription>
            Buat template kosong dulu sebagai draft. Isi pages + theme
            di halaman detail setelah dibuat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Nama *</Label>
              <Input
                id="t-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Restoran Modern"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-slug">Slug *</Label>
              <Input
                id="t-slug"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
                placeholder="restoran-modern"
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Huruf kecil + hyphen, unique global
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Deskripsi</Label>
            <Input
              id="t-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Template untuk restoran / cafe / bakery"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-cat">Kategori</Label>
              <select
                id="t-cat"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="school">School</option>
                <option value="umkm">UMKM</option>
                <option value="portfolio">Portfolio</option>
                <option value="blog">Blog</option>
                <option value="landing">Landing</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-var">Variant</Label>
              <select
                id="t-var"
                value={form.variant}
                onChange={(e) => setForm((f) => ({ ...f, variant: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="modern">Modern</option>
                <option value="clean">Clean</option>
                <option value="professional">Professional</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Thumbnail (opsional)</Label>
            <ThumbnailPicker
              value={form.preview_url}
              onChange={(url) => setForm((f) => ({ ...f, preview_url: url }))}
            />
          </div>

          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {err}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Buat Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------- Duplicate dialog --------

function DuplicateTemplateDialog({
  target,
  onClose,
  onDuplicated,
}: {
  target: Template | null;
  onClose: () => void;
  onDuplicated: () => void;
}) {
  const [newSlug, setNewSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      // Default slug: <original>-copy — admin bisa edit.
      setNewSlug(`${target.slug}-copy`);
      setErr(null);
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    setErr(null);
    const slug = newSlug.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
      setErr("Slug harus huruf kecil, angka, hyphen, 2-40 karakter");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/v1/admin/templates/${target.id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ new_slug: slug }),
      });
      toast.success(`"${target.name}" berhasil di-duplicate sebagai draft`);
      onDuplicated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate Template</DialogTitle>
          <DialogDescription>
            {target && (
              <>
                Copy dari <b>{target.name}</b> ({target.slug}) → template baru
                dengan slug custom. Copy default status <b>draft</b>, source{" "}
                <b>Custom</b>, boleh full edit + delete.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-slug">Slug baru *</Label>
            <Input
              id="d-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
              placeholder="restoran-modern-custom"
              className="font-mono"
              autoFocus
            />
          </div>

          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {err}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

// Admin template detail — full editor: metadata + theme (ThemeEditor) +
// pages (TemplatePagesEditor dengan block editor 3-panel + undo/redo).
// Publish/archive/republish action + preview link ke renderer.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Blocks,
  Eye,
  ExternalLink,
  Loader2,
  Package,
  Save,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeEditor, type ThemeValue } from "@/components/theme/ThemeEditor";
import {
  TemplatePagesEditor,
  type TemplatePage,
} from "@/components/templates/TemplatePagesEditor";
import { ThumbnailPicker } from "@/components/templates/ThumbnailPicker";

type Template = {
  id: string;
  slug: string;
  category: string;
  variant: string;
  name: string;
  description: string;
  preview_url: string;
  preview_screenshot_url: string;
  theme: unknown;
  pages: unknown;
  status: "draft" | "published" | "archived";
  source: "builtin" | "admin";
  is_premium: boolean;
  created_at: string;
  updated_at: string;
};

const RENDERER_BASE =
  process.env.NEXT_PUBLIC_RENDERER_BASE ?? "http://localhost";

export default function AdminTemplateEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [tpl, setTpl] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    slug: string;
    name: string;
    description: string;
    category: string;
    variant: string;
    preview_url: string;
    is_premium: boolean;
    theme: ThemeValue;
    pages: TemplatePage[];
  }>({
    slug: "",
    name: "",
    description: "",
    category: "umkm",
    variant: "modern",
    preview_url: "",
    is_premium: false,
    theme: {},
    pages: [],
  });

  useEffect(() => {
    setLoading(true);
    api<Template>(`/api/v1/admin/templates/${id}`)
      .then((t) => {
        setTpl(t);
        setForm({
          slug: t.slug,
          name: t.name,
          description: t.description,
          category: t.category,
          variant: t.variant,
          preview_url: t.preview_url,
          is_premium: t.is_premium,
          // theme di-store sebagai object supaya ThemeEditor bisa langsung
          // consume. Fallback ke {} kalau backend kirim null.
          theme: (t.theme as ThemeValue) ?? {},
          // Pages parsed sebagai array — kalau backend kirim null / non-array,
          // fallback ke [].
          pages: Array.isArray(t.pages) ? (t.pages as TemplatePage[]) : [],
        });
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  async function save() {
    if (!tpl) return;
    setErr(null);
    // Theme + pages sudah object (ThemeEditor + TemplatePagesEditor sync
    // parent state). PATCH langsung — validation minimal server-side.
    setSaving(true);
    try {
      const updated = await api<Template>(`/api/v1/admin/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          slug: form.slug,
          name: form.name,
          description: form.description,
          category: form.category,
          variant: form.variant,
          preview_url: form.preview_url,
          is_premium: form.is_premium,
          theme: form.theme,
          pages: form.pages,
        }),
      });
      setTpl(updated);
      toast.success("Template tersimpan");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function statusAction(action: "publish" | "archive" | "unpublish") {
    if (!tpl) return;
    setSaving(true);
    try {
      let updated: Template;
      if (action === "publish") {
        updated = await api(`/api/v1/admin/templates/${id}/publish`, {
          method: "POST",
        });
        toast.success("Template dipublish");
      } else if (action === "archive") {
        updated = await api(`/api/v1/admin/templates/${id}/archive`, {
          method: "POST",
        });
        toast.success("Template diarsipkan");
      } else {
        updated = await api(`/api/v1/admin/templates/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "draft" }),
        });
        toast.success("Dikembalikan ke draft");
      }
      setTpl(updated);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Memuat template…
      </div>
    );
  }
  if (err || !tpl) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/admin/templates">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <span>{err || "Template tidak ditemukan"}</span>
        </div>
      </div>
    );
  }

  const previewURL =
    tpl.status === "published"
      ? `${RENDERER_BASE}/template-preview/${encodeURIComponent(tpl.slug)}`
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/admin/templates">
            <ArrowLeft className="size-4" />
            Daftar Template
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{tpl.name}</h1>
            <StatusBadge status={tpl.status} />
            {tpl.source === "builtin" ? (
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
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{tpl.slug}</span> · {tpl.category} · {tpl.variant}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {previewURL && (
            <Button asChild variant="outline" className="gap-1.5">
              <a href={previewURL} target="_blank" rel="noopener noreferrer">
                <Eye className="size-4" />
                Preview
                <ExternalLink className="size-3" />
              </a>
            </Button>
          )}
          {tpl.status === "draft" && (
            <Button onClick={() => statusAction("publish")} disabled={saving} className="gap-1.5">
              Publish
            </Button>
          )}
          {tpl.status === "published" && (
            <Button
              variant="outline"
              onClick={() => statusAction("archive")}
              disabled={saving}
              className="gap-1.5"
            >
              Archive
            </Button>
          )}
          {tpl.status === "archived" && (
            <Button onClick={() => statusAction("publish")} disabled={saving} className="gap-1.5">
              Republish
            </Button>
          )}
        </div>
      </div>

      {tpl.source === "builtin" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <div>
            <p className="font-medium">Template built-in</p>
            <p className="mt-1 text-xs">
              Perubahan di sini akan hilang saat server restart (source of truth =
              file <code>builtin.go</code>). Kalau mau permanen edit, klik{" "}
              <b>Duplicate</b> dari list dan edit copy-nya.
            </p>
          </div>
        </div>
      )}

      {/* Tabs — Metadata | Tema | Halaman */}
      <Tabs defaultValue="pages" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="metadata" className="gap-1.5">
            <Package className="size-3.5" />
            Metadata
          </TabsTrigger>
          <TabsTrigger value="theme" className="gap-1.5">
            <Eye className="size-3.5" />
            Tema
          </TabsTrigger>
          <TabsTrigger value="pages" className="gap-1.5">
            <Blocks className="size-3.5" />
            Halaman
          </TabsTrigger>
        </TabsList>

        {/* -------- METADATA TAB -------- */}
        <TabsContent value="metadata" className="mt-4 space-y-4">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3 border-b pb-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Package className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Metadata</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Informasi identitas template: nama, slug, kategori, dan thumbnail
                yang tampil di wizard.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="f-name">Nama</Label>
              <Input
                id="f-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-slug">Slug</Label>
              <Input
                id="f-slug"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="f-desc">Deskripsi</Label>
            <Input
              id="f-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="f-cat">Kategori</Label>
              <select
                id="f-cat"
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
              <Label htmlFor="f-var">Variant</Label>
              <select
                id="f-var"
                value={form.variant}
                onChange={(e) => setForm((f) => ({ ...f, variant: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="modern">Modern</option>
                <option value="clean">Clean</option>
                <option value="professional">Professional</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Thumbnail</Label>
              <ThumbnailPicker
                value={form.preview_url}
                onChange={(url) => setForm((f) => ({ ...f, preview_url: url }))}
              />
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_premium}
              onChange={(e) => setForm((f) => ({ ...f, is_premium: e.target.checked }))}
            />
            Premium (butuh subscription)
          </label>
        </CardContent>
      </Card>
        </TabsContent>

        {/* -------- THEME TAB -------- */}
        <TabsContent value="theme" className="mt-4 space-y-4">
      {/* Theme visual editor — colors + fonts + radius + live preview */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3 border-b pb-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Eye className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Tema</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Warna, font, dan radius yang akan di-apply ke situs baru yang
                pakai template ini.
              </p>
            </div>
          </div>
          <ThemeEditor
            value={form.theme}
            onChange={(next) => setForm((f) => ({ ...f, theme: next }))}
          />
        </CardContent>
      </Card>
        </TabsContent>

        {/* -------- PAGES TAB -------- */}
        <TabsContent value="pages" className="mt-4 space-y-4">
      {/* Pages editor — visual page manager + block editor per page */}
      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Blocks className="size-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  Struktur Halaman
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Susun halaman + block yang jadi kerangka template. Minimal{" "}
                  <b>1 halaman</b> dengan tanda{" "}
                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    HOME
                  </span>{" "}
                  wajib sebelum publish.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="rounded-md border bg-muted/40 px-2 py-1 font-mono">
                {form.pages.length} halaman
              </span>
              <span className="rounded-md border bg-muted/40 px-2 py-1 font-mono">
                {form.pages.reduce(
                  (acc, p) => acc + (p.tree?.blocks?.length ?? 0),
                  0,
                )}{" "}
                block total
              </span>
            </div>
          </div>
          <TemplatePagesEditor
            value={form.pages}
            onChange={(next) => setForm((f) => ({ ...f, pages: next }))}
            templateId={tpl.id}
            templateUpdatedAt={tpl.updated_at}
            onSaveRequest={save}
            saving={saving}
          />
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
        <p className="mr-auto text-xs text-muted-foreground">
          Terakhir di-update: {formatDate(tpl.updated_at)}
        </p>
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Menyimpan…
            </>
          ) : (
            <>
              <Save className="size-4" />
              Simpan
            </>
          )}
        </Button>
      </div>
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

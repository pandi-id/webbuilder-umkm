"use client";

// ArticleForm — full-page editor untuk artikel platform (create + edit).
// Pattern mirip apps/web/app/sites/[id]/blog/BlogForm.tsx: sticky toolbar +
// main column (title + slug + RichEditor) + sidebar metadata.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Newspaper,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  PLATFORM_ARTICLE_CATEGORIES,
  type PlatformArticle,
  type PlatformArticleCategory,
} from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import { ImagePicker } from "@/components/ImagePicker";
import { RichEditor } from "@/components/RichEditor";
import { useAutoSavedAgo } from "@/lib/useAutoSavedAgo";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function ArticleForm({ article }: { article: PlatformArticle | null }) {
  const router = useRouter();
  const isEdit = !!article;

  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [bodyMD, setBodyMD] = useState(article?.body_md ?? "");
  const [cover, setCover] = useState(article?.cover_image_url ?? "");
  const [category, setCategory] = useState<PlatformArticleCategory>(article?.category ?? "umum");
  const [author, setAuthor] = useState(article?.author_name ?? "Tim Web Builder");
  const [tagsText, setTagsText] = useState((article?.tags ?? []).join(", "));
  const [status, setStatus] = useState<"draft" | "published">(article?.status ?? "draft");
  const [featured, setFeatured] = useState(article?.featured ?? false);
  const [readingTime, setReadingTime] = useState(article?.reading_time_min ?? 0);
  const [seoTitle, setSeoTitle] = useState(article?.seo_title ?? "");
  const [seoDesc, setSeoDesc] = useState(article?.seo_description ?? "");
  const [saving, setSaving] = useState<"draft" | "published" | null>(null);

  // Auto-derive slug from title in CREATE mode until user manually edits.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(slugify(title));
  }, [title, slugTouched]);

  const tags = useMemo(
    () => tagsText.split(",").map((t) => t.trim()).filter(Boolean),
    [tagsText],
  );

  // Dirty tracking + autosave — pattern sama dengan TulisanForm.
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    JSON.stringify({
      title: article?.title ?? "",
      slug: article?.slug ?? "",
      excerpt: article?.excerpt ?? "",
      bodyMD: article?.body_md ?? "",
      cover: article?.cover_image_url ?? "",
      category: article?.category ?? "umum",
      author: article?.author_name ?? "Tim Web Builder",
      tagsText: (article?.tags ?? []).join(", "),
      featured: article?.featured ?? false,
      readingTime: article?.reading_time_min ?? 0,
      seoTitle: article?.seo_title ?? "",
      seoDesc: article?.seo_description ?? "",
    }),
  );
  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        title,
        slug,
        excerpt,
        bodyMD,
        cover,
        category,
        author,
        tagsText,
        featured,
        readingTime,
        seoTitle,
        seoDesc,
      }),
    [title, slug, excerpt, bodyMD, cover, category, author, tagsText, featured, readingTime, seoTitle, seoDesc],
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

  async function save(
    targetStatus: "draft" | "published",
    opts?: { silent?: boolean },
  ) {
    if (!title.trim()) {
      if (!opts?.silent) toast.error("Judul artikel wajib diisi");
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
        title,
        excerpt,
        body_md: bodyMD,
        cover_image_url: cover,
        category,
        author_name: author,
        tags,
        status: targetStatus,
        featured,
        reading_time_min: readingTime,
        seo_title: seoTitle,
        seo_description: seoDesc,
      };
      if (isEdit) {
        await api(`/api/v1/admin/platform-articles/${article!.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!opts?.silent) {
          toast.success(
            targetStatus === "published" ? "Artikel dipublikasikan" : "Perubahan disimpan",
          );
        }
      } else {
        await api(`/api/v1/admin/platform-articles`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!opts?.silent) {
          toast.success(
            targetStatus === "published"
              ? "Artikel dibuat & dipublikasikan"
              : "Draft tersimpan",
          );
        }
      }
      setStatus(targetStatus);
      setSavedSnapshot(currentSnapshot);
      setLastAutoSavedAt(Date.now());
      if (!opts?.silent) {
        router.push("/admin/platform-articles");
      }
    } catch (e) {
      if (!opts?.silent) toast.error((e as Error).message);
      else console.warn("autosave failed:", (e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  useEffect(() => {
    if (!isEdit) return;
    if (!dirty) return;
    if (saving) return;
    if (!title.trim() || !slug.trim()) return;
    const handle = window.setTimeout(() => {
      void save(status, { silent: true });
    }, 3000);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot, dirty, saving, isEdit, status]);

  return (
    <div className="space-y-6">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link
                href="/admin/platform-articles"
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
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10">
                <Newspaper className="size-4 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">
                  {isEdit ? "Edit Artikel Platform" : "Artikel Platform Baru"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isEdit ? title || "Tanpa judul" : "Blog / knowledge base level platform"}
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
            <Badge variant={status === "published" ? "success" : "secondary"} className="gap-1">
              {status === "published" ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <Clock className="size-3" />
              )}
              {status === "published" ? "Published" : "Draft"}
            </Badge>
            {featured && (
              <Badge variant="warning" className="gap-1">
                <Sparkles className="size-3" />
                Featured
              </Badge>
            )}
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
              onClick={() => save("published")}
              disabled={saving !== null}
              className="gap-2 shadow-sm"
            >
              {saving === "published" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {status === "published" ? "Update" : "Publikasikan"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main column — title + slug + RichEditor */}
        <div className="space-y-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Judul artikel…"
            className="h-auto border-0 bg-transparent px-0 text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="slug" className="shrink-0 text-muted-foreground">
              URL slug
            </Label>
            <span className="font-mono text-muted-foreground">/artikel/</span>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                setSlugTouched(true);
              }}
              placeholder="auto-dari-judul"
              className="h-8 max-w-md font-mono text-sm"
            />
          </div>

          {/* TipTap Rich Editor — HTML ↔ Markdown roundtrip di dalam */}
          <RichEditor
            value={bodyMD}
            onChange={setBodyMD}
            placeholder="Tulis konten artikel di sini. Pakai toolbar di atas untuk format teks, atau ketik / untuk shortcut."
          />
        </div>

        {/* Sidebar — metadata */}
        <aside className="space-y-4">
          {/* Cover */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Cover Image</CardTitle>
            </CardHeader>
            <CardContent>
              <ImagePicker value={cover} onChange={setCover} />
            </CardContent>
          </Card>

          {/* Publish */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Publikasi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="category" className="text-xs">
                  Kategori
                </Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as PlatformArticleCategory)}
                >
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORM_ARTICLE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                  className="size-4"
                />
                <Sparkles className="size-4 text-amber-500" />
                Featured (pin di homepage)
              </label>

              <div className="space-y-1.5">
                <Label htmlFor="status" className="text-xs">
                  Status
                </Label>
                <Select value={status} onValueChange={(v) => setStatus(v as "draft" | "published")}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Status final ditentukan tombol Simpan/Publikasikan.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="author" className="text-xs">Penulis</Label>
                <Input
                  id="author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Nama penulis"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="excerpt" className="text-xs">Excerpt</Label>
                <Textarea
                  id="excerpt"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  rows={3}
                  placeholder="Ringkasan singkat untuk preview di kartu artikel."
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reading" className="text-xs">
                  Waktu Baca (menit)
                </Label>
                <Input
                  id="reading"
                  type="number"
                  min={0}
                  value={readingTime}
                  onChange={(e) => setReadingTime(parseInt(e.target.value || "0", 10))}
                  className="max-w-[100px]"
                />
                <p className="text-[11px] text-muted-foreground">0 = disembunyikan</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tags" className="text-xs">Tags</Label>
                <Input
                  id="tags"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="tutorial, umkm, toko online"
                />
                {tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* SEO */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">SEO (opsional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="seo_title" className="text-xs">SEO Title</Label>
                <Input
                  id="seo_title"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder="Kosong = pakai judul artikel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seo_desc" className="text-xs">SEO Description</Label>
                <Textarea
                  id="seo_desc"
                  value={seoDesc}
                  onChange={(e) => setSeoDesc(e.target.value)}
                  rows={2}
                  placeholder="Kosong = pakai excerpt"
                />
              </div>
            </CardContent>
          </Card>

          {article?.published_at && (
            <Card>
              <CardContent className="py-3 text-xs text-muted-foreground">
                Dipublikasikan{" "}
                {new Date(article.published_at).toLocaleString("id-ID", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

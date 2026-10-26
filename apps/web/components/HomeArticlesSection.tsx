"use client";

// HomeArticlesSection — platform articles (tips for UMKM) on the landing page.
// Fetch 4 artikel published terbaru (featured di-prioritas). Kalau kosong,
// section tidak render (hide).

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Calendar, Clock } from "lucide-react";
import { api, type PlatformArticle } from "@/lib/api";

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function categoryColor(cat: string): string {
  switch (cat) {
    case "tutorial": return "bg-blue-500/10 text-blue-700";
    case "cerita": return "bg-violet-500/10 text-violet-700";
    case "tips": return "bg-emerald-500/10 text-emerald-700";
    case "panduan": return "bg-amber-500/10 text-amber-700";
    case "pengumuman": return "bg-rose-500/10 text-rose-700";
    default: return "bg-slate-500/10 text-slate-700";
  }
}

export function HomeArticlesSection() {
  const [items, setItems] = useState<PlatformArticle[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<PlatformArticle[]>(`/public/platform-articles?limit=4`, { auth: false })
      .then((r) => {
        setItems(r ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Kalau belum load atau kosong, tidak render section (avoid layout shift).
  if (!loaded || items.length === 0) return null;

  const [featured, ...rest] = items;

  return (
    <section id="artikel" className="border-t border-[#ebe3d8] bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2.5 text-xs font-extrabold uppercase tracking-[.13em] text-[#d73f45]">
              <span className="h-0.5 w-6 rounded-full bg-current" />
              Artikel
            </div>
            <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-extrabold leading-tight tracking-tight text-[#172033]">
              Tips &amp; Panduan untuk UMKM
            </h2>
            <p className="mt-3 text-sm text-[#637083] sm:text-base">
              Cara memotret produk, menulis deskripsi yang menjual, sampai
              membuat toko mudah ditemukan di Google.
            </p>
          </div>
          <Link
            href="/artikel"
            className="inline-flex items-center gap-1 text-sm font-extrabold text-[#d73f45] transition hover:translate-x-0.5"
          >
            Lihat semua artikel
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-[1.15fr_.85fr]">
          {/* Featured artikel — dark navy card */}
          <Link
            href={`/artikel/${featured.slug}`}
            className="group flex min-h-[320px] flex-col justify-end overflow-hidden rounded-[22px] bg-gradient-to-br from-[#172033] to-[#2b3d5e] p-8 text-white transition hover:shadow-2xl"
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${categoryColor(featured.category)}`}>
                {featured.category}
              </span>
              {featured.reading_time_min > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-white/60">
                  <Clock className="size-3" /> {featured.reading_time_min} menit
                </span>
              )}
            </div>
            <h3 className="mb-2 text-2xl font-bold leading-tight text-white sm:text-[1.7rem]">
              {featured.title}
            </h3>
            <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-white/75">
              {featured.excerpt}
            </p>
            <div className="flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-white/60">
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" /> {fmtDate(featured.published_at)}
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-white transition group-hover:translate-x-0.5">
                Baca <ArrowRight className="size-3" />
              </span>
            </div>
          </Link>

          {/* 3 side card */}
          <div className="grid gap-4">
            {rest.slice(0, 3).map((a) => (
              <Link
                key={a.id}
                href={`/artikel/${a.slug}`}
                className="group flex items-start gap-4 rounded-[18px] border border-[#ebe3d8] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#d4dce8] hover:shadow-md"
              >
                <div className="flex size-14 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-[#fdf0dc] to-[#fce9ea] text-[#d73f45]">
                  <BookOpen className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${categoryColor(a.category)}`}>
                      {a.category}
                    </span>
                  </div>
                  <h3 className="line-clamp-2 text-[15px] font-bold leading-tight text-[#172033]">
                    {a.title}
                  </h3>
                  <p className="mt-1 line-clamp-1 text-xs text-[#637083]">
                    {a.excerpt}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

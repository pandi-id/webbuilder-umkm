// /panduan — public user guide for shop owners. Rendered at build time from
// docs/user-guide/10-panduan-client.md so the markdown stays the single source
// for web + PDF.

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { Marked } from "marked";
import { Button } from "@/components/ui/button";
import { PanduanBackToTop } from "./BackToTop";

export const metadata = {
  title: "Dokumentasi — Panduan Membuat Toko Online",
  description:
    "Panduan lengkap membuat toko online UMKM: daftar akun, beli domain .id, pilih template toko, kelola produk, dan publikasikan.",
};

function loadGuideMarkdown(): string {
  const file = path.join(process.cwd(), "..", "..", "docs", "user-guide", "10-panduan-client.md");
  let md: string;
  try {
    md = fs.readFileSync(file, "utf-8");
  } catch {
    return "Panduan belum tersedia.";
  }
  return (
    md
      // The page hero already carries the title.
      .replace(/^# .*\n/, "")
      // Screenshots predate the UMKM UI; hide them until they are recaptured.
      .replace(/^!\[[^\]]*\]\([^)]*\)\s*\n/gm, "")
  );
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Own instance so heading ids don't leak into other pages that use `marked`.
const guideMarked = new Marked({ gfm: true, breaks: false });
guideMarked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const plain = tokens.map((t) => ("text" in t ? t.text : "")).join("");
      return `<h${depth} id="${slugifyHeading(plain)}">${text}</h${depth}>`;
    },
  },
});

function extractTOC(md: string): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      const title = m[1].replace(/[*_`]/g, "").trim();
      out.push({ id: slugifyHeading(title), title });
    }
  }
  return out;
}

export default function PanduanPage() {
  const md = loadGuideMarkdown();
  const html = guideMarked.parse(md) as string;
  const toc = extractTOC(md);

  return (
    <div className="min-h-screen bg-[#fbf8f3]">
      <header className="sticky top-0 z-20 border-b border-[#ece6dc] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft />
              Beranda
            </Link>
          </Button>
          <Button asChild size="sm" className="bg-[#d73f45] text-white hover:bg-[#c23238]">
            <Link href="/register">Buat Toko Online</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-8 pt-12 sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f2a93b]/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#9a5b00]">
          <BookOpen className="size-3.5" /> Dokumentasi
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-[#172033] sm:text-5xl">
          Panduan Membuat Toko Online
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#5b6475]">
          Langkah demi langkah dari daftar akun, beli domain <code className="rounded bg-white px-1.5 py-0.5 text-[0.9em]">.id</code>,
          pilih template toko, isi produk, sampai toko Anda tayang dan siap
          menerima pesanan lewat WhatsApp.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#ece6dc] bg-white px-3 py-2 text-xs text-[#5b6475]">
          <Search className="size-3.5 shrink-0" />
          <span>
            Tekan <kbd className="rounded border bg-[#fbf8f3] px-1 font-mono">Ctrl+F</kbd> (
            <kbd className="rounded border bg-[#fbf8f3] px-1 font-mono">⌘+F</kbd> di Mac) untuk mencari di
            halaman ini.
          </span>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 pb-24 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav
            aria-label="Daftar isi"
            className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-[#ece6dc] bg-white p-4 shadow-sm"
          >
            <div className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-[#d73f45]">
              Daftar Isi
            </div>
            <ul className="space-y-1 text-sm">
              {toc.map((it) => (
                <li key={it.id}>
                  <a
                    href={`#${it.id}`}
                    className="line-clamp-2 rounded-md px-2 py-1 text-[#4c5566] transition-colors hover:bg-[#fbf8f3] hover:text-[#172033]"
                  >
                    {it.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0">
          <details className="mb-6 rounded-xl border border-[#ece6dc] bg-white p-4 shadow-sm lg:hidden">
            <summary className="cursor-pointer text-sm font-bold text-[#d73f45]">
              Daftar Isi ({toc.length} bagian)
            </summary>
            <ul className="mt-3 space-y-1 text-sm">
              {toc.map((it) => (
                <li key={it.id}>
                  <a
                    href={`#${it.id}`}
                    className="block rounded-md px-2 py-1 text-[#4c5566] hover:bg-[#fbf8f3] hover:text-[#172033]"
                  >
                    {it.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <div
            className="wb-guide rounded-2xl border border-[#ece6dc] bg-white p-5 shadow-sm sm:p-10"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>
      </div>

      <section className="border-t border-[#ece6dc] bg-[#172033] px-4 py-14 text-white sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-extrabold">Siap buka toko online?</h2>
          <p className="mt-2 text-sm text-white/70">
            Daftar sekarang, beli domain .id, dan pilih template toko. Semua langkah di panduan ini
            sudah tersedia di dashboard Anda.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild className="bg-[#d73f45] text-white hover:bg-[#c23238]">
              <Link href="/register">Buat Toko Online</Link>
            </Button>
            <Button variant="outline" asChild className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
              <Link href="/login">Sudah punya akun? Masuk</Link>
            </Button>
          </div>
        </div>
      </section>

      <PanduanBackToTop />

      <style
        dangerouslySetInnerHTML={{
          __html: `
.wb-guide { color: #172033; line-height: 1.75; font-size: 1rem; overflow-wrap: anywhere; }
.wb-guide > :first-child { margin-top: 0; }
.wb-guide h2 { font-size: 1.5rem; font-weight: 800; color: #172033; margin: 2.5rem 0 .75em; padding-bottom: .35em; border-bottom: 2px solid #f2a93b; scroll-margin-top: 5rem; }
.wb-guide h3 { font-size: 1.15rem; font-weight: 700; color: #172033; margin: 1.6rem 0 .5em; scroll-margin-top: 5rem; }
.wb-guide p { margin: 0 0 1em; }
.wb-guide a { color: #d73f45; text-decoration: underline; text-underline-offset: 2px; }
.wb-guide strong { font-weight: 700; }
.wb-guide code { background: #fbf8f3; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.wb-guide pre { background: #172033; color: #f4f7fb; padding: 1em 1.2em; border-radius: 10px; overflow-x: auto; font-size: 0.8em; line-height: 1.5; margin: 1.4em 0; }
.wb-guide pre code { background: none; padding: 0; color: inherit; }
.wb-guide table { display: block; overflow-x: auto; border-collapse: collapse; width: 100%; margin: 1.4em 0; font-size: 0.93em; }
.wb-guide th, .wb-guide td { border: 1px solid #ece6dc; padding: .6em .8em; text-align: left; vertical-align: top; }
.wb-guide th { background: #fbf8f3; font-weight: 700; }
.wb-guide blockquote { border-left: 3px solid #d73f45; padding: .1em 0 .1em 1.2em; margin: 1.4em 0; color: #4c5566; }
.wb-guide ul, .wb-guide ol { margin: .5em 0 1em; padding-left: 1.5em; }
.wb-guide ul { list-style: disc; }
.wb-guide ol { list-style: decimal; }
.wb-guide li { margin: .35em 0; }
.wb-guide hr { border: none; border-top: 1px solid #ece6dc; margin: 2em 0; }
`,
        }}
      />
    </div>
  );
}

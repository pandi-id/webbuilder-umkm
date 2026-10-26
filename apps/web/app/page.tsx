import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Lock,
  MessageCircle,
  Quote,
  ShieldCheck,
  Store,
} from "lucide-react";
import { HomeNavAuth } from "@/components/HomeNavAuth";
import { HomeMobileNav } from "@/components/HomeMobileNav";
import { HomeArticlesSection } from "@/components/HomeArticlesSection";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DrawnUnderline, LandingMotion, Reveal } from "@/components/landing/Reveal";
import { HeroStoreMockup } from "@/components/landing/HeroStoreMockup";
import { ChannelMarquee } from "@/components/landing/ChannelMarquee";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { StepsTimeline } from "@/components/landing/StepsTimeline";
import { TemplateShowcase } from "@/components/landing/TemplateShowcase";
import { StatsCounters } from "@/components/landing/StatsCounters";

// Marketing landing for UMKM. Stays a server component; every animated part
// lives in a small client island under components/landing/.
// Palette: cream #fbf8f3 · navy #172033 · red #d73f45 · amber #f2a93b · WA green #1f9d55.

const BRAND = "Web Builder";

const navLinks = [
  { href: "#fitur", label: "Fitur" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#contoh", label: "Contoh Toko" },
  { href: "#faq", label: "FAQ" },
  { href: "/artikel", label: "Artikel" },
];

// Illustrative personas only — not real customers, and labelled as such.
const stories = [
  {
    quote:
      "Dulu pelanggan tanya harga satu per satu lewat chat. Sekarang cukup kirim link toko, mereka pilih menu sendiri lalu langsung pesan lewat WhatsApp.",
    persona: "Pemilik usaha kuliner rumahan",
    place: "Bandung",
    initials: "KR",
    tone: "bg-[#fdf0dc] text-[#b86e0a]",
  },
  {
    quote:
      "Punya alamat .id sendiri bikin usaha kami terlihat lebih serius. Waktu menawarkan ke toko oleh-oleh, cukup tunjukkan katalog di website.",
    persona: "Perajin anyaman bambu",
    place: "Yogyakarta",
    initials: "PA",
    tone: "bg-[#e8f0dc] text-[#4d6b2c]",
  },
  {
    quote:
      "Daftar layanan dan harga sudah jelas di website, jadi calon pelanggan datang dengan pertanyaan yang lebih sedikit. Pesanan lebih cepat diproses.",
    persona: "Pemilik usaha jasa laundry",
    place: "Makassar",
    initials: "JL",
    tone: "bg-[#eaf2fb] text-[#285f9e]",
  },
];

const faqs = [
  {
    q: "Apakah saya perlu bisa coding?",
    a: "Tidak sama sekali. Anda memilih template, lalu mengubah teks, foto, dan produk lewat editor drag & drop. Semua bisa dilakukan dari laptop maupun ponsel.",
  },
  {
    q: "Kenapa harus membeli domain terlebih dahulu?",
    a: "Setiap toko memakai alamat .id miliknya sendiri — satu domain untuk satu toko. Domain dibeli langsung di wizard pembuatan toko dan terdaftar atas nama Anda, jadi identitas usaha tetap milik Anda.",
  },
  {
    q: "Bagaimana pelanggan memesan produk?",
    a: "Pelanggan bisa menekan tombol Pesan via WhatsApp yang langsung membuka chat dengan Anda, atau mengisi formulir pesanan yang masuk ke dashboard toko.",
  },
  {
    q: "Apakah toko saya bisa muncul di Google?",
    a: "Bisa. Judul halaman, deskripsi, dan sitemap disiapkan otomatis agar mudah dibaca mesin pencari. Posisi di hasil pencarian tetap bergantung pada isi toko dan persaingan, jadi rajin memperbarui produk dan artikel akan sangat membantu.",
  },
  {
    q: "Apakah website saya aman?",
    a: "Setiap toko otomatis mendapat sertifikat SSL (HTTPS), sehingga muncul ikon gembok di browser dan data pengunjung terenkripsi.",
  },
  {
    q: "Bagaimana kalau masa aktif domain hampir habis?",
    a: "Kami mengirim email pengingat sebelum domain kedaluwarsa. Perpanjangan bisa dilakukan langsung dari dashboard dalam beberapa klik.",
  },
  {
    q: "Apakah saya bisa memindahkan website ke tempat lain?",
    a: "Bisa. Website dapat diekspor menjadi file HTML statis, sehingga Anda tidak terkunci pada satu layanan.",
  },
];

function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <div
      className={`mb-4 inline-flex items-center gap-2.5 text-xs font-extrabold uppercase tracking-[.14em] ${
        light ? "text-[#f2a93b]" : "text-[#d73f45]"
      }`}
    >
      <span className="h-0.5 w-6 rounded-full bg-current" />
      {children}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  desc,
  center = false,
}: {
  eyebrow: string;
  title: ReactNode;
  desc?: string;
  center?: boolean;
}) {
  return (
    <Reveal className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-[clamp(1.85rem,4vw,3rem)] font-extrabold leading-[1.08] tracking-[-.03em] text-[#172033]">
        {title}
      </h2>
      {desc && <p className="mt-4 text-base leading-relaxed text-[#5b6577] sm:text-lg">{desc}</p>}
    </Reveal>
  );
}

const primaryCta =
  "h-12 gap-2 rounded-2xl bg-[#d73f45] px-6 text-[15px] font-extrabold text-white shadow-[0_14px_30px_-10px_rgba(215,63,69,.7)] transition hover:-translate-y-0.5 hover:bg-[#c2353b]";
const secondaryCta =
  "h-12 gap-2 rounded-2xl border-[#e3dbcf] bg-white px-6 text-[15px] font-extrabold text-[#172033] transition hover:-translate-y-0.5 hover:bg-[#faf5ee]";

export default function Home() {
  return (
    <LandingMotion>
      <main className="relative min-h-screen overflow-x-clip bg-[#fbf8f3] text-[#172033]">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-[#ebe3d8]/80 bg-[#fbf8f3]/85 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label={`Beranda ${BRAND}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#d73f45] text-white shadow-[0_8px_18px_-8px_rgba(215,63,69,.8)]">
                <Store className="size-[18px]" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[15px] font-black tracking-tight">{BRAND}</span>
                <span className="hidden text-[11px] font-semibold text-[#5b6577] sm:block">Toko online .id untuk UMKM</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-7 lg:flex" aria-label="Navigasi utama">
              {navLinks.map((l) => (
                <Link key={l.href} href={l.href} className="text-sm font-bold text-[#3a4558] transition hover:text-[#d73f45]">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <HomeNavAuth />
              <HomeMobileNav />
            </div>
          </div>
        </header>

        {/* Hero */}
        <section id="top" className="relative">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 8% 0%, rgba(242,169,59,.16), transparent 28rem)," +
                "radial-gradient(circle at 95% 10%, rgba(215,63,69,.10), transparent 30rem)",
            }}
            aria-hidden
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_.95fr] lg:gap-10 lg:pb-24 lg:pt-20">
            <div>
              <Reveal y={12}>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#f3d9b0] bg-[#fff6e8] py-1 pl-1 pr-3.5 text-xs font-bold text-[#8a5200]">
                  <span className="rounded-full bg-[#f2a93b] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#172033]">
                    UMKM
                  </span>
                  Website toko + domain .id dalam satu tempat
                </span>
              </Reveal>
              <h1 className="mt-6 text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] tracking-[-.035em]">
                Toko online sendiri untuk usaha Anda, lengkap dengan{" "}
                <span className="relative inline-block whitespace-nowrap text-[#d73f45]">
                  domain .id
                  <DrawnUnderline className="absolute -bottom-1.5 left-0 h-3 w-full text-[#f2a93b]" />
                </span>
              </h1>
              <Reveal delay={0.1} y={16}>
                <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-[#5b6577] sm:text-lg">
                  Pamerkan produk, terima pesanan lewat WhatsApp, dan mudah
                  ditemukan di Google. Semua diatur sendiri dari satu dashboard,
                  tanpa perlu coding.
                </p>
              </Reveal>
              <Reveal delay={0.2} y={16}>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button size="lg" asChild className={primaryCta}>
                    <Link href="/register">
                      Buat Toko Online
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild className={secondaryCta}>
                    <Link href="#contoh">Lihat Contoh</Link>
                  </Button>
                </div>
              </Reveal>
              <Reveal delay={0.3} y={12}>
                <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-[#3a4558]">
                  {["Tanpa coding", "SSL otomatis", "Rapi di ponsel"].map((t) => (
                    <li key={t} className="inline-flex items-center gap-1.5">
                      <span className="grid size-5 place-items-center rounded-full bg-[#e5f6ec] text-[#1f9d55]">
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
            <HeroStoreMockup />
          </div>
        </section>

        {/* Channels strip */}
        <section className="border-y border-[#ebe3d8] bg-white/60 py-8 sm:py-10" aria-label="Kanal yang dipakai pelanggan">
          <p className="mb-5 px-4 text-center text-sm font-semibold text-[#5b6577]">
            Terhubung dengan cara pelanggan Anda mencari, memesan, dan membayar
          </p>
          <ChannelMarquee />
        </section>

        {/* Features */}
        <section id="fitur" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
          <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading
              eyebrow="Fitur"
              title="Semua yang dibutuhkan toko Anda untuk jualan online"
              desc="Bukan sekadar halaman profil. Katalog, pemesanan, dan promosi bekerja bersama supaya pengunjung berubah jadi pembeli."
            />
            <Reveal delay={0.1} className="md:shrink-0">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-[#ebe3d8] bg-white px-4 py-3 text-sm font-semibold text-[#3a4558]">
                <ShieldCheck className="size-4 text-[#1f9d55]" />
                HTTPS aktif untuk setiap toko
              </div>
            </Reveal>
          </div>
          <FeatureGrid />
        </section>

        {/* How it works */}
        <section id="cara-kerja" className="scroll-mt-20 border-y border-[#ebe3d8] bg-[#f6f0e7]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <div className="mb-14 md:mb-16">
              <SectionHeading
                center
                eyebrow="Cara kerja"
                title="Tiga langkah sampai toko Anda online"
                desc="Mulai dari nama domain, pilih tampilan, lalu isi produk. Tidak perlu menyewa developer atau mengurus server."
              />
            </div>
            <StepsTimeline />
            <Reveal delay={0.2} className="mt-14 flex justify-center">
              <Button size="lg" asChild className={primaryCta}>
                <Link href="/register">
                  Mulai dari domain Anda
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </Reveal>
          </div>
        </section>

        {/* Showcase */}
        <section id="contoh" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
          <div className="mb-12">
            <SectionHeading
              eyebrow="Contoh toko"
              title="Tampilan yang pas untuk berbagai jenis usaha"
              desc="Gambaran toko yang bisa Anda buat. Warna, font, dan susunan halaman dapat disesuaikan dengan karakter usaha Anda."
            />
          </div>
          <TemplateShowcase />
        </section>

        {/* Stats band */}
        <section className="px-4 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-[#172033] px-6 py-14 sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[#d73f45]/25 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-28 -left-16 size-72 rounded-full bg-[#f2a93b]/20 blur-3xl" aria-hidden />
            <div className="relative">
              <Reveal className="mb-12 max-w-2xl">
                <Eyebrow light>Kenapa online</Eyebrow>
                <h2 className="text-[clamp(1.75rem,3.6vw,2.6rem)] font-extrabold leading-[1.1] tracking-[-.03em] text-white">
                  Pelanggan mencari di internet dulu, baru membeli
                </h2>
              </Reveal>
              <StatsCounters />
            </div>
          </div>
        </section>

        {/* Illustrative stories */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="mb-12">
            <SectionHeading
              eyebrow="Gambaran penggunaan"
              title="Seperti apa rasanya punya toko online sendiri"
              desc="Contoh cerita ilustrasi dari jenis usaha yang paling sering memakai website toko — bukan testimoni pelanggan nyata."
            />
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {stories.map((s, i) => (
              <Reveal key={s.persona} delay={i * 0.1} className="h-full">
                <figure className="flex h-full flex-col rounded-[24px] border border-[#ebe3d8] bg-white p-6 sm:p-7">
                  <Quote className="size-7 text-[#f2a93b]" />
                  <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-[#3a4558]">
                    {s.quote}
                  </blockquote>
                  <figcaption className="mt-6 flex items-center gap-3 border-t border-[#f0ebe4] pt-5">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-full text-xs font-black ${s.tone}`}>
                      {s.initials}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block text-sm font-extrabold text-[#172033]">{s.persona}</span>
                      <span className="text-xs text-[#5b6577]">{s.place} · ilustrasi</span>
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-[#ebe3d8] bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[.8fr_1.2fr] lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="FAQ"
                title="Pertanyaan yang sering diajukan"
                desc="Belum menemukan jawabannya? Baca panduan dan tips lengkap di halaman artikel."
              />
              <Reveal delay={0.1}>
                <Link
                  href="/artikel"
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-extrabold text-[#d73f45] transition hover:gap-2.5"
                >
                  Buka artikel &amp; panduan
                  <ArrowRight className="size-4" />
                </Link>
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <Accordion type="single" collapsible defaultValue="faq-0" className="border-t border-[#ebe3d8]">
                {faqs.map((f, i) => (
                  <AccordionItem key={f.q} value={`faq-${i}`} className="border-[#ebe3d8]">
                    <AccordionTrigger className="py-5 text-base font-bold text-[#172033] hover:no-underline">
                      {f.q}
                    </AccordionTrigger>
                    <AccordionContent className="pr-8 text-[15px] leading-relaxed text-[#5b6577]">
                      {f.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Reveal>
          </div>
        </section>

        {/* Platform articles (hidden when empty) */}
        <HomeArticlesSection />

        {/* Final CTA */}
        <section aria-labelledby="final-title" className="px-4 py-20 sm:px-6 sm:py-24">
          <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-gradient-to-br from-[#d73f45] to-[#b92f45] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute -left-20 -top-20 size-64 rounded-full bg-white/10" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -right-10 size-72 rounded-full bg-[#f2a93b]/30" aria-hidden />
            <div className="relative mx-auto max-w-2xl">
              <h2 id="final-title" className="text-[clamp(2rem,5vw,3.4rem)] font-extrabold leading-[1.05] tracking-[-.035em]">
                Saatnya usaha Anda punya alamat sendiri di internet
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
                Pilih domain .id, pasang produk, dan bagikan link toko ke
                pelanggan hari ini juga.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  asChild
                  className="h-12 gap-2 rounded-2xl bg-white px-6 text-[15px] font-extrabold text-[#c2353b] shadow-[0_14px_30px_-10px_rgba(23,32,51,.5)] transition hover:-translate-y-0.5 hover:bg-[#fff6f0]"
                >
                  <Link href="/register">
                    Buat Toko Online
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="h-12 gap-2 rounded-2xl border-white/40 bg-transparent px-6 text-[15px] font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
                >
                  <Link href="#faq">Tanya-tanya dulu</Link>
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-semibold text-white/85">
                <li className="inline-flex items-center gap-1.5"><Lock className="size-4" /> SSL otomatis</li>
                <li className="inline-flex items-center gap-1.5"><MessageCircle className="size-4" /> Pesanan via WhatsApp</li>
                <li className="inline-flex items-center gap-1.5"><Store className="size-4" /> Domain .id atas nama Anda</li>
              </ul>
            </div>
          </Reveal>
        </section>

        {/* Footer */}
        <footer className="bg-[#111a2b] text-white/70">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-xl bg-[#d73f45] text-white">
                    <Store className="size-[18px]" />
                  </span>
                  <span className="text-base font-black text-white">{BRAND}</span>
                </div>
                <p className="mt-4 max-w-xs text-sm leading-relaxed">
                  Website toko online dengan domain .id untuk UMKM Indonesia.
                  Katalog, pesanan WhatsApp, dan promosi dalam satu tempat.
                </p>
              </div>
              <div>
                <h4 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-white/50">Produk</h4>
                <ul className="space-y-2 text-sm">
                  <li><Link href="#fitur" className="hover:text-white">Fitur</Link></li>
                  <li><Link href="#cara-kerja" className="hover:text-white">Cara Kerja</Link></li>
                  <li><Link href="#contoh" className="hover:text-white">Contoh Toko</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-white/50">Bantuan</h4>
                <ul className="space-y-2 text-sm">
                  <li><Link href="#faq" className="hover:text-white">FAQ</Link></li>
                  <li><Link href="/artikel" className="hover:text-white">Artikel &amp; Panduan</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-white/50">Akun</h4>
                <ul className="space-y-2 text-sm">
                  <li><Link href="/register" className="hover:text-white">Daftar</Link></li>
                  <li><Link href="/login" className="hover:text-white">Masuk</Link></li>
                  <li><Link href="/daftar-reseller" className="hover:text-white">Reseller / Agency</Link></li>
                </ul>
              </div>
            </div>
            <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
              <p>© {new Date().getFullYear()} {BRAND}. Hak cipta dilindungi.</p>
              <p>Domain .id · Toko online untuk UMKM Indonesia</p>
            </div>
          </div>
        </footer>
      </main>
    </LandingMotion>
  );
}

"use client";

import { motion } from "motion/react";
import {
  BarChart3,
  Globe,
  GripVertical,
  MessageCircle,
  Newspaper,
  Package,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";

type Feature = {
  title: string;
  desc: string;
  icon: typeof Package;
  tone: string;
  span?: string;
  visual?: ReactNode;
};

const CatalogVisual = (
  <div className="mt-6 grid grid-cols-3 gap-2" aria-hidden>
    {[
      ["from-[#f6d9b8] to-[#e9a96b]", "Rp 22.000"],
      ["from-[#f8d4d5] to-[#e4797d]", "Rp 95.000"],
      ["from-[#d6e6f5] to-[#8fb3dc]", "Rp 49.000"],
    ].map(([tile, price]) => (
      <div key={price} className="rounded-xl border border-[#f0ebe4] bg-white p-1.5">
        <div className={`aspect-[4/3] rounded-lg bg-gradient-to-br ${tile}`} />
        <div className="mt-1.5 h-1.5 w-3/4 rounded-full bg-[#ece6dd]" />
        <div className="mt-1 text-[10px] font-extrabold text-[#d73f45]">{price}</div>
      </div>
    ))}
  </div>
);

const EditorVisual = (
  <div className="mt-6 space-y-2" aria-hidden>
    {["Banner promo", "Daftar produk", "Testimoni"].map((label, i) => (
      <div
        key={label}
        className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-bold text-[#3a4558] ${
          i === 1 ? "translate-x-3 border-[#d73f45]/40 shadow-[0_10px_24px_-10px_rgba(215,63,69,.45)]" : "border-[#f0ebe4]"
        }`}
      >
        <GripVertical className="size-3.5 text-[#a3abb8]" />
        {label}
      </div>
    ))}
  </div>
);

const features: Feature[] = [
  {
    title: "Katalog Produk",
    desc: "Tampilkan foto, harga, dan deskripsi produk dalam katalog yang rapi. Pelanggan tinggal pilih yang mereka mau.",
    icon: Package,
    tone: "bg-[#fdf0dc] text-[#b86e0a]",
    span: "md:col-span-2",
    visual: CatalogVisual,
  },
  {
    title: "Pesan via WhatsApp",
    desc: "Tombol pesan langsung membuka chat WhatsApp Anda, atau pakai formulir pesanan yang masuk ke dashboard.",
    icon: MessageCircle,
    tone: "bg-[#e5f6ec] text-[#1f9d55]",
  },
  {
    title: "Domain .id Sendiri",
    desc: "Alamat toko yang mudah diingat, misalnya tokoanda.id — terdaftar atas nama Anda, lengkap dengan SSL.",
    icon: Globe,
    tone: "bg-[#fde8e8] text-[#d73f45]",
  },
  {
    title: "Tampil di Google",
    desc: "Judul, deskripsi, dan sitemap disiapkan otomatis supaya toko Anda lebih mudah ditemukan calon pembeli.",
    icon: Search,
    tone: "bg-[#eaf2fb] text-[#285f9e]",
  },
  {
    title: "Statistik Pengunjung",
    desc: "Lihat berapa orang yang mampir dan halaman mana yang paling sering dibuka, tanpa pasang alat tambahan.",
    icon: BarChart3,
    tone: "bg-[#efeafb] text-[#6b4bc4]",
  },
  {
    title: "Editor Drag & Drop",
    desc: "Susun halaman dengan menyeret blok: banner, produk, testimoni, kontak. Tidak perlu menulis kode sama sekali.",
    icon: GripVertical,
    tone: "bg-[#fdf0dc] text-[#b86e0a]",
    span: "md:col-span-2",
    visual: EditorVisual,
  },
  {
    title: "Blog untuk Promosi",
    desc: "Tulis kabar toko, resep, atau tips pemakaian produk. Konten yang bermanfaat mendatangkan pembeli baru.",
    icon: Newspaper,
    tone: "bg-[#e5f6ec] text-[#1f9d55]",
  },
];

export function FeatureGrid() {
  return (
    <div className="grid gap-4 sm:gap-5 md:grid-cols-3">
      {features.map((f, i) => (
        <motion.article
          key={f.title}
          className={`group relative overflow-hidden rounded-[24px] border border-[#ebe3d8] bg-white p-6 transition-shadow duration-300 hover:shadow-[0_24px_50px_-20px_rgba(23,32,51,.28)] sm:p-7 ${f.span ?? ""}`}
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          whileHover={{ y: -6 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.55, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className={`grid size-11 place-items-center rounded-2xl ${f.tone}`}>
            <f.icon className="size-5" />
          </div>
          <h3 className="mt-5 text-lg font-extrabold tracking-tight text-[#172033]">{f.title}</h3>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-[#5b6577]">{f.desc}</p>
          {f.visual}
        </motion.article>
      ))}
    </div>
  );
}

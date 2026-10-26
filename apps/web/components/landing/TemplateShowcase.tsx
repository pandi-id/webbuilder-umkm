"use client";

import { motion } from "motion/react";
import { Palette, Scissors, Shirt, UtensilsCrossed } from "lucide-react";

type Showcase = {
  label: string;
  store: string;
  domain: string;
  desc: string;
  icon: typeof Shirt;
  // Each mini preview gets its own palette so the grid reads as four stores.
  bg: string;
  bar: string;
  hero: string;
  tiles: [string, string, string];
  accent: string;
};

const items: Showcase[] = [
  {
    label: "Kuliner",
    store: "Dapur Rasa",
    domain: "dapurrasa.id",
    desc: "Menu lengkap dengan foto menggugah selera, jam buka, dan tombol pesan antar.",
    icon: UtensilsCrossed,
    bg: "bg-[#fff6ec]",
    bar: "bg-[#7a3f12]",
    hero: "from-[#f2a93b] to-[#d9622b]",
    tiles: ["from-[#f6d9b8] to-[#e9a96b]", "from-[#fbe6c4] to-[#f2b85a]", "from-[#f3c9a4] to-[#c96b3a]"],
    accent: "text-[#b86e0a] bg-[#fdf0dc]",
  },
  {
    label: "Fashion",
    store: "Rupa Wastra",
    domain: "rupawastra.id",
    desc: "Lookbook koleksi terbaru, pilihan ukuran, dan katalog yang enak dilihat di ponsel.",
    icon: Shirt,
    bg: "bg-[#fbf1f4]",
    bar: "bg-[#5b1f3a]",
    hero: "from-[#e4797d] to-[#9b3b6a]",
    tiles: ["from-[#f8d4d5] to-[#e4797d]", "from-[#efd5e4] to-[#b86b97]", "from-[#f5e0d6] to-[#d79b85]"],
    accent: "text-[#b23a63] bg-[#fbe4ec]",
  },
  {
    label: "Kerajinan",
    store: "Anyam Lestari",
    domain: "anyamlestari.id",
    desc: "Cerita di balik setiap karya tangan, galeri produk, dan info pemesanan khusus.",
    icon: Palette,
    bg: "bg-[#f4f6ee]",
    bar: "bg-[#3f5a2a]",
    hero: "from-[#9bb46a] to-[#5d7a3a]",
    tiles: ["from-[#e2e9cf] to-[#a8bd7b]", "from-[#efe3cc] to-[#c9a46a]", "from-[#dde6d3] to-[#7f9a5c]"],
    accent: "text-[#4d6b2c] bg-[#e8f0dc]",
  },
  {
    label: "Jasa",
    store: "Rapi Laundry",
    domain: "rapilaundry.id",
    desc: "Daftar layanan dan harga, area jangkauan, serta formulir booking yang sederhana.",
    icon: Scissors,
    bg: "bg-[#eef4fb]",
    bar: "bg-[#1e3f66]",
    hero: "from-[#5b8fd0] to-[#285f9e]",
    tiles: ["from-[#d6e6f5] to-[#8fb3dc]", "from-[#dfe9f7] to-[#a7c1e6]", "from-[#d3e0ef] to-[#6f95c4]"],
    accent: "text-[#285f9e] bg-[#eaf2fb]",
  },
];

function MiniSite({ s }: { s: Showcase }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-black/5 ${s.bg}`} aria-hidden>
      <div className="flex items-center gap-1 border-b border-black/5 bg-white/70 px-2.5 py-1.5">
        <span className="size-1.5 rounded-full bg-black/15" />
        <span className="size-1.5 rounded-full bg-black/15" />
        <span className="size-1.5 rounded-full bg-black/15" />
        <span className="ml-1.5 truncate text-[9px] font-semibold text-black/45">{s.domain}</span>
      </div>
      <div className="p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[10px] font-black text-[#172033]">{s.store}</span>
          <span className={`h-1.5 w-8 rounded-full ${s.bar} opacity-60`} />
        </div>
        <div className={`mb-2.5 flex h-16 items-end rounded-xl bg-gradient-to-br ${s.hero} p-2.5 transition-transform duration-500 group-hover:scale-[1.03]`}>
          <div className="space-y-1">
            <div className="h-1.5 w-16 rounded-full bg-white/90" />
            <div className="h-1 w-10 rounded-full bg-white/60" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {s.tiles.map((t) => (
            <div key={t} className="rounded-lg bg-white p-1">
              <div className={`aspect-square rounded-md bg-gradient-to-br ${t}`} />
              <div className="mt-1 h-1 w-3/4 rounded-full bg-black/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TemplateShowcase() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((s, i) => (
        <motion.article
          key={s.label}
          className="group rounded-[26px] border border-[#ebe3d8] bg-white p-3 transition-shadow duration-300 hover:shadow-[0_28px_60px_-24px_rgba(23,32,51,.35)]"
          initial={{ opacity: 0, y: 32, rotate: i % 2 ? 1.5 : -1.5 }}
          whileInView={{ opacity: 1, y: 0, rotate: 0 }}
          whileHover={{ y: -8 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <MiniSite s={s} />
          <div className="px-2 pb-2 pt-4">
            <div className="flex items-center gap-2">
              <span className={`grid size-8 place-items-center rounded-xl ${s.accent}`}>
                <s.icon className="size-4" />
              </span>
              <h3 className="text-base font-extrabold text-[#172033]">{s.label}</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#5b6577]">{s.desc}</p>
          </div>
        </motion.article>
      ))}
    </div>
  );
}

"use client";

import { motion } from "motion/react";
import { Globe, LayoutTemplate, Rocket } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

// Mirrors the real product flow: a domain must be bought before a site exists.
const steps = [
  {
    icon: Globe,
    title: "Beli domain .id",
    desc: "Cari nama toko, cek ketersediaannya, lalu selesaikan pembayaran. Domain langsung didaftarkan atas nama Anda.",
    hint: "tokoanda.id",
  },
  {
    icon: LayoutTemplate,
    title: "Pilih template toko",
    desc: "Pilih desain yang cocok dengan usaha Anda. Warna, font, dan logo bisa disesuaikan kapan saja.",
    hint: "Kuliner · Fashion · Jasa",
  },
  {
    icon: Rocket,
    title: "Tambah produk & publikasikan",
    desc: "Unggah foto dan harga produk, atur nomor WhatsApp, lalu klik Publikasikan. Toko Anda langsung bisa dikunjungi.",
    hint: "Toko online",
  },
];

export function StepsTimeline() {
  return (
    <div className="relative">
      {/* Connector: vertical on mobile, horizontal through the badges on md+ */}
      <div className="absolute bottom-8 left-[27px] top-8 w-0.5 bg-[#ebe3d8] md:hidden" aria-hidden>
        <motion.div
          className="h-full w-full origin-top bg-gradient-to-b from-[#d73f45] to-[#f2a93b]"
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      </div>
      <div className="absolute left-[16.66%] right-[16.66%] top-[27px] hidden h-0.5 bg-[#ebe3d8] md:block" aria-hidden>
        <motion.div
          className="h-full w-full origin-left bg-gradient-to-r from-[#d73f45] to-[#f2a93b]"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 1.2, ease: EASE, delay: 0.2 }}
        />
      </div>

      <ol className="relative grid gap-8 md:grid-cols-3 md:gap-6">
        {steps.map((s, i) => (
          <motion.li
            key={s.title}
            className="flex gap-5 md:flex-col md:items-center md:text-center"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.55, delay: 0.15 + i * 0.25, ease: EASE }}
          >
            <div className="relative z-10 grid size-14 shrink-0 place-items-center rounded-2xl border-4 border-[#fbf8f3] bg-[#172033] text-white shadow-[0_12px_28px_-10px_rgba(23,32,51,.6)]">
              <s.icon className="size-5" />
              <span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-[#d73f45] text-[11px] font-black text-white ring-2 ring-[#fbf8f3]">
                {i + 1}
              </span>
            </div>
            <div className="min-w-0 pt-1 md:pt-5">
              <h3 className="text-lg font-extrabold tracking-tight text-[#172033]">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#5b6577] md:mx-auto md:max-w-[19rem]">{s.desc}</p>
              <span className="mt-3 inline-flex rounded-full border border-[#ebe3d8] bg-white px-3 py-1 text-xs font-bold text-[#5b6577]">
                {s.hint}
              </span>
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

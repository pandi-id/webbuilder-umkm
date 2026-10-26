"use client";

import { motion, type Transition } from "motion/react";
import {
  BadgeCheck,
  Bell,
  Coffee,
  Cookie,
  Lock,
  MessageCircle,
  Plus,
  ShoppingBag,
  Star,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { useIdleMotion } from "./useIdleMotion";

const EASE: Transition["ease"] = [0.22, 1, 0.36, 1];

const products = [
  { name: "Kopi Gula Aren", price: "Rp 22.000", icon: Coffee, tile: "from-[#f6d9b8] to-[#e9a96b]", fg: "text-[#7a3f12]" },
  { name: "Kue Lumpur", price: "Rp 18.000", icon: Cookie, tile: "from-[#fbe6c4] to-[#f2b85a]", fg: "text-[#7a4b07]" },
  { name: "Paket Hampers", price: "Rp 95.000", icon: ShoppingBag, tile: "from-[#f8d4d5] to-[#e4797d]", fg: "text-[#7c1f24]" },
];

// Gentle idle bob; no infinite loop is scheduled for reduced-motion users.
function Float({ children, delay = 0, distance = 8, enabled }: { children: ReactNode; delay?: number; distance?: number; enabled: boolean }) {
  return (
    <motion.div
      animate={enabled ? { y: [0, -distance, 0] } : undefined}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay }}
    >
      {children}
    </motion.div>
  );
}

function Chip({ children, className, delay }: { children: ReactNode; className: string; delay: number }) {
  return (
    <motion.div
      className={`absolute z-20 ${className}`}
      initial={{ opacity: 0, scale: 0.85, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function HeroStoreMockup() {
  const float = useIdleMotion();

  return (
    <div className="relative mx-auto w-full max-w-[560px] px-1 pb-14 pt-8 sm:px-6 sm:pb-16" aria-hidden>
      {/* Warm glow behind the frame */}
      <div className="pointer-events-none absolute inset-x-6 top-10 bottom-8 rounded-[40px] bg-gradient-to-br from-[#fde3c8] via-[#fbeee3] to-[#f9d3d4] blur-2xl" />

      {/* Browser frame */}
      <motion.div
        className="relative z-10"
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <Float enabled={float} distance={6}>
          <div className="overflow-hidden rounded-[22px] border border-[#ebe3d8] bg-white shadow-[0_30px_70px_-20px_rgba(23,32,51,.35)]">
            <div className="flex items-center gap-1.5 border-b border-[#f0ebe4] bg-[#faf7f2] px-3.5 py-2.5">
              <span className="size-2.5 rounded-full bg-[#f1a7a2]" />
              <span className="size-2.5 rounded-full bg-[#f4d28b]" />
              <span className="size-2.5 rounded-full bg-[#a9dcb6]" />
              <div className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-[#5b6577] ring-1 ring-[#efe9e1]">
                <Lock className="size-3 shrink-0 text-[#1f9d55]" />
                <span className="truncate">tokoanda.id</span>
              </div>
            </div>

            <div className="p-3.5 sm:p-5">
              {/* Store nav */}
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-[#172033] text-[11px] font-black text-white">KS</span>
                  <span className="text-[13px] font-extrabold text-[#172033]">Kopi Senja</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="hidden h-1.5 w-8 rounded-full bg-[#ece6dd] sm:block" />
                  <span className="hidden h-1.5 w-8 rounded-full bg-[#ece6dd] sm:block" />
                  <span className="relative grid size-7 place-items-center rounded-lg bg-[#faf3ea] text-[#172033]">
                    <ShoppingBag className="size-3.5" />
                    <span className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-[#d73f45] text-[8px] font-bold text-white">2</span>
                  </span>
                </div>
              </div>

              {/* Banner */}
              <div className="relative mb-3.5 overflow-hidden rounded-2xl bg-gradient-to-br from-[#172033] to-[#2b3d5e] p-4 text-white">
                <div className="absolute -right-6 -top-8 size-28 rounded-full bg-[#f2a93b]/30" />
                <div className="absolute -bottom-10 right-10 size-24 rounded-full bg-[#d73f45]/30" />
                <span className="relative inline-flex rounded-full bg-[#f2a93b] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#172033]">
                  Promo minggu ini
                </span>
                <div className="relative mt-2 max-w-[70%] text-[15px] font-extrabold leading-tight sm:text-[17px]">
                  Kopi lokal, diseduh setiap pagi
                </div>
                <div className="relative mt-1.5 flex items-center gap-1 text-[10px] text-white/70">
                  <Star className="size-3 fill-[#f2a93b] text-[#f2a93b]" /> 4,9 dari pelanggan setia
                </div>
              </div>

              {/* Product grid */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {products.map((p, i) => (
                  <motion.div
                    key={p.name}
                    className="rounded-xl border border-[#f0ebe4] bg-white p-1.5 sm:p-2"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.35 + i * 0.12, ease: EASE }}
                  >
                    <div className={`grid aspect-square place-items-center rounded-lg bg-gradient-to-br ${p.tile}`}>
                      <p.icon className={`size-6 sm:size-7 ${p.fg}`} strokeWidth={1.75} />
                    </div>
                    <div className="mt-1.5 truncate text-[10px] font-bold text-[#172033] sm:text-[11px]">{p.name}</div>
                    <div className="mt-0.5 flex items-center justify-between">
                      <span className="text-[10px] font-extrabold text-[#d73f45] sm:text-[11px]">{p.price}</span>
                      <span className="hidden size-4 place-items-center rounded-md bg-[#172033] text-white sm:grid">
                        <Plus className="size-2.5" />
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* WhatsApp CTA */}
              <motion.div
                className="mt-3.5 flex items-center justify-center gap-2 rounded-xl bg-[#1f9d55] py-2.5 text-[12px] font-extrabold text-white"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.75, ease: EASE }}
              >
                <MessageCircle className="size-4" />
                Pesan via WhatsApp
              </motion.div>
            </div>
          </div>
        </Float>
      </motion.div>

      {/* Phone with chat — overlaps the frame bottom-right */}
      <motion.div
        className="absolute bottom-0 right-0 z-20 w-[132px] sm:-right-2 sm:w-[168px]"
        initial={{ opacity: 0, y: 40, rotate: 6 }}
        animate={{ opacity: 1, y: 0, rotate: 3 }}
        transition={{ duration: 0.7, delay: 0.55, ease: EASE }}
      >
        <Float enabled={float} delay={1.2} distance={10}>
          <div className="rounded-[26px] bg-[#172033] p-1.5 shadow-[0_24px_50px_-12px_rgba(23,32,51,.5)]">
            <div className="overflow-hidden rounded-[20px] bg-[#efe7dc]">
              <div className="flex items-center gap-1.5 bg-[#1f7a4a] px-2.5 py-2 text-white">
                <span className="grid size-5 place-items-center rounded-full bg-white/20 text-[8px] font-black">KS</span>
                <div className="leading-none">
                  <div className="text-[9px] font-bold">Kopi Senja</div>
                  <div className="text-[7px] text-white/70">online</div>
                </div>
              </div>
              <div className="space-y-1.5 p-2 text-[8.5px] leading-snug sm:text-[9.5px]">
                <div className="ml-auto max-w-[88%] rounded-lg rounded-tr-sm bg-[#d9f7c8] px-2 py-1.5 text-[#172033]">
                  Halo kak, mau pesan 2 Kopi Gula Aren ya
                </div>
                <div className="max-w-[88%] rounded-lg rounded-tl-sm bg-white px-2 py-1.5 text-[#172033]">
                  Siap kak, totalnya Rp 44.000. Dikirim ke mana?
                </div>
                <div className="ml-auto h-3 w-10 rounded-full bg-[#d9f7c8]" />
              </div>
            </div>
          </div>
        </Float>
      </motion.div>

      {/* Floating status chips */}
      <Chip className="left-0 top-0 sm:-left-2" delay={0.9}>
        <Float enabled={float} delay={0.3}>
          <div className="flex items-center gap-2 rounded-full border border-[#efe7dc] bg-white/95 py-1.5 pl-1.5 pr-3 text-[11px] font-bold text-[#172033] shadow-[0_12px_30px_-8px_rgba(23,32,51,.25)] backdrop-blur">
            <span className="relative grid size-6 place-items-center rounded-full bg-[#fde8e8] text-[#d73f45]">
              <Bell className="size-3.5" />
              <span className="absolute right-0 top-0 size-1.5 rounded-full bg-[#d73f45]" />
            </span>
            Pesanan baru masuk
          </div>
        </Float>
      </Chip>

      <Chip className="right-0 top-[30%] hidden sm:block sm:-right-4" delay={1.05}>
        <Float enabled={float} delay={0.8}>
          <div className="flex items-center gap-2 rounded-2xl border border-[#efe7dc] bg-white/95 px-3 py-2 shadow-[0_12px_30px_-8px_rgba(23,32,51,.25)] backdrop-blur">
            <span className="grid size-7 place-items-center rounded-xl bg-[#eaf2fb] text-[#285f9e]">
              <TrendingUp className="size-4" />
            </span>
            <div className="leading-tight">
              <div className="text-[13px] font-black text-[#172033]">+128</div>
              <div className="text-[10px] font-medium text-[#5b6577]">pengunjung hari ini</div>
            </div>
          </div>
        </Float>
      </Chip>

      <Chip className="bottom-3 left-0 sm:-left-3 sm:bottom-5" delay={1.2}>
        <Float enabled={float} delay={1.6}>
          <div className="flex items-center gap-2 rounded-full border border-[#d6efdf] bg-white/95 py-1.5 pl-1.5 pr-3 text-[11px] font-bold text-[#172033] shadow-[0_12px_30px_-8px_rgba(23,32,51,.25)] backdrop-blur">
            <span className="grid size-6 place-items-center rounded-full bg-[#e5f6ec] text-[#1f9d55]">
              <BadgeCheck className="size-3.5" />
            </span>
            <span>
              <span className="hidden sm:inline">Domain </span>
              <span className="text-[#1f9d55]">tokoanda.id</span> aktif
            </span>
          </div>
        </Float>
      </Chip>
    </div>
  );
}

"use client";

import { motion } from "motion/react";
import {
  Banknote,
  CreditCard,
  Instagram,
  Landmark,
  MapPin,
  MessageCircle,
  QrCode,
  Search,
  Truck,
  Wallet,
} from "lucide-react";
import { useIdleMotion } from "./useIdleMotion";

const channels = [
  { label: "WhatsApp", icon: MessageCircle },
  { label: "QRIS", icon: QrCode },
  { label: "Transfer Bank", icon: Landmark },
  { label: "Google Search", icon: Search },
  { label: "Google Maps", icon: MapPin },
  { label: "E-wallet", icon: Wallet },
  { label: "Instagram", icon: Instagram },
  { label: "Kartu Debit", icon: CreditCard },
  { label: "Bayar di Tempat", icon: Banknote },
  { label: "Kurir Lokal", icon: Truck },
];

function Badge({ label, icon: Icon }: (typeof channels)[number]) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#ebe3d8] bg-white px-4 py-2 text-sm font-bold text-[#3a4558] shadow-[0_1px_0_rgba(23,32,51,.04)]">
      <Icon className="size-4 text-[#d73f45]" />
      {label}
    </span>
  );
}

export function ChannelMarquee() {
  const animate = useIdleMotion();

  // Track is duplicated (spacing via padding, not gap) so -50% loops seamlessly. Reduced
  // motion keeps the same DOM (no hydration diff) but stays still.
  return (
    <div className="wb-marquee-mask overflow-hidden">
      <motion.div
        className="flex w-max"
        animate={animate ? { x: ["0%", "-50%"] } : undefined}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
      >
        {[...channels, ...channels].map((c, i) => (
          <span key={`${c.label}-${i}`} className="pr-3" aria-hidden={i >= channels.length || undefined}>
            <Badge {...c} />
          </span>
        ))}
      </motion.div>
    </div>
  );
}

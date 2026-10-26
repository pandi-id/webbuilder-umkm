"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

type Stat = { value?: number; text?: string; suffix?: string; label: string };

// Deliberately generic, verifiable facts — no invented customer counts.
const stats: Stat[] = [
  { value: 5, suffix: " menit", label: "untuk menyusun halaman toko pertama dari template" },
  { value: 24, suffix: "/7", label: "toko tetap buka, bahkan saat Anda sedang istirahat" },
  { text: ".id", label: "domain resmi Indonesia, terdaftar atas nama Anda" },
  { value: 100, suffix: "%", label: "tampil rapi di ponsel, tablet, dan laptop" },
];

function Counter({ to, suffix }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  // Server markup shows the final number (no-JS safe); the count-up only
  // starts once the section scrolls into view, so the reset is never seen.
  const [n, setN] = useState(to);
  const started = useRef(false);

  useEffect(() => {
    if (reduce || started.current) return;
    if (!inView) {
      setN(0);
      return;
    }
    started.current = true;
    const controls = animate(0, to, {
      duration: 1.4,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setN(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, reduce, to]);

  return (
    <span ref={ref} className="tabular-nums">
      {n}
      {suffix}
    </span>
  );
}

export function StatsCounters() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="border-l-2 border-[#f2a93b] pl-4 sm:pl-5">
          <p className="text-[clamp(2rem,5vw,3.25rem)] font-black leading-none tracking-tight text-white">
            {s.value !== undefined ? <Counter to={s.value} suffix={s.suffix} /> : s.text}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-white/65">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

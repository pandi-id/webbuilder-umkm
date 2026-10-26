"use client";

import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";

// "user" = honour prefers-reduced-motion: transforms become instant, opacity
// fades stay, so nothing is ever stuck invisible.
export function LandingMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  /** Fraction of the element that must be visible before it animates. */
  amount?: number;
};

// Scroll-reveal island so section markup can stay in the server component.
export function Reveal({ children, className, delay = 0, y = 24, amount = 0.2 }: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// Hand-drawn underline under the hero highlight; draws once on load.
export function DrawnUnderline({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 300 16"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
    >
      <motion.path
        d="M3 11C60 4 140 2 297 8"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, delay: 0.5, ease: [0.65, 0, 0.35, 1] }}
      />
    </svg>
  );
}

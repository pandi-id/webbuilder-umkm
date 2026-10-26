"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

// Gate for looping/ambient animation. False on the server and first client
// render so markup always hydrates identically, then honours reduced motion.
export function useIdleMotion(): boolean {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !reduce;
}

"use client";

// Floating "back to top" button, shown once the reader is past the first screen
// of a long guide.

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export function PanduanBackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Kembali ke atas"
      title="Kembali ke atas"
      className="fixed bottom-6 right-6 z-30 grid size-12 place-items-center rounded-full bg-[#d73f45] text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-[#c23238]"
    >
      <ArrowUp className="size-5" />
    </button>
  );
}

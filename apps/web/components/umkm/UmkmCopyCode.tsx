"use client";

// Voucher copy button. Byte-identical in apps/web and apps/renderer; the static
// export renders the code as plain text instead.
import { useState } from "react";
import { UMKM_ICONS } from "@/lib/umkm";

export function UmkmCopyCode({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        // Older in-app browsers (e.g. some Android WebViews) lack the async API.
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("copy failed");
      }
      setState("done");
    } catch {
      setState("fail");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className="wb-umkm-copy" onClick={copy} aria-label={`Salin kode voucher ${code}`}>
      <svg
        className="wb-umkm-ic wb-umkm-ic--sm"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: state === "done" ? UMKM_ICONS.check : UMKM_ICONS.copy }}
      />
      <span aria-live="polite">{state === "done" ? "Tersalin" : state === "fail" ? "Salin manual" : "Salin"}</span>
    </button>
  );
}

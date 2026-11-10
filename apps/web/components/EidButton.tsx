"use client";

// EidButton — "Masuk dengan e.id". Same as GoogleButton: redirect to the API
// authorize endpoint, the whole OAuth exchange happens server-side. Hides
// itself until the server has e.id credentials (GET /auth/providers), so it
// is safe to deploy before e.id issues them.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://api.localhost";

export function EidButton({
  next,
  label = "Masuk dengan e.id",
  className = "",
}: {
  next?: string;
  label?: string;
  className?: string;
}) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ eid: boolean }>("/api/v1/auth/providers", { auth: false })
      .then((p) => !cancelled && setEnabled(p.eid))
      .catch(() => {
        // Check failed = hide; a button that surely errors is worse.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  function onClick() {
    const url = new URL("/api/v1/auth/eid/authorize", API_BASE);
    if (next) url.searchParams.set("next", next);
    window.location.href = url.toString();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex h-10 w-full items-center justify-center gap-3 rounded-lg border bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted " +
        className
      }
    >
      <EidMark />
      {label}
    </button>
  );
}

// Neutral text mark — replace with the official e.id logo once e.id publishes
// branding guidelines.
function EidMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-[18px] items-center rounded bg-slate-900 px-1 text-[10px] font-bold leading-none tracking-tight text-white"
    >
      e.id
    </span>
  );
}

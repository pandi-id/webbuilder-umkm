"use client";

// CTA nav untuk beranda — swap tombol "Masuk / Daftar" jadi "Ke Portal"
// kalau user sudah login. Beda dari AuthedHomeRedirect yang lama (auto-redirect
// yang bikin landing page tidak accessible sekalipun user cuma mau share URL
// atau browse template).
//
// Render optimis: server render + first-paint tampilkan tombol guest (tidak
// blank). Setelah client check `/auth/me` sukses, swap ke "Ke Portal".

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { api, clearTokens, getAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { defaultRouteForRole } from "@/lib/roles";

export function HomeNavAuth() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!getAccessToken()) return;
    let cancelled = false;
    api<{ role: string }>("/api/v1/auth/me")
      .then((me) => {
        if (!cancelled) setTarget(defaultRouteForRole(me.role));
      })
      .catch(() => {
        // Token invalid → bersihkan diam-diam, biarkan user lihat form guest.
        clearTokens();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (target) {
    return (
      <Button asChild className="h-10 gap-1.5 rounded-xl bg-[#172033] px-4 font-bold text-white shadow-sm hover:bg-[#24314a]">
        <Link href={target}>
          <LayoutDashboard className="size-3.5" />
          Ke Portal
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        asChild
        className="hidden h-10 rounded-xl px-4 font-bold text-[#172033] hover:bg-[#172033]/5 sm:inline-flex"
      >
        <Link href="/register">Daftar</Link>
      </Button>
      <Button asChild className="h-10 gap-1.5 rounded-xl bg-[#172033] px-4 font-bold text-white shadow-sm hover:bg-[#24314a]">
        <Link href="/login">
          Masuk
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </>
  );
}

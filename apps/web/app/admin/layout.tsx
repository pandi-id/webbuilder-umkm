"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Briefcase, Users, Globe2, ArrowLeft, LogOut, ShieldCheck, Loader2, Cloud, ScrollText, DollarSign, LayoutTemplate, Mail, Settings, MapPin, CreditCard, Receipt, Tag, Wallet, Newspaper, HardDrive } from "lucide-react";
import { api, clearTokens, getAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type Me = { id: string; email: string; name: string; role: string };

const nav = [
  { href: "/admin", label: "Overview", icon: BarChart3 },
  { href: "/admin/users", label: "Pengguna", icon: Users },
  { href: "/admin/resellers", label: "Reseller", icon: Briefcase },
  { href: "/admin/sites", label: "Situs", icon: Globe2 },
  { href: "/admin/assets", label: "Aset", icon: HardDrive },
  { href: "/admin/platform-articles", label: "Artikel Platform", icon: Newspaper },
  { href: "/admin/templates", label: "Template", icon: LayoutTemplate },
  { href: "/admin/pricing", label: "Pricing", icon: DollarSign },
  { href: "/admin/promos", label: "Promo", icon: Tag },
  { href: "/admin/zones", label: "Zones", icon: MapPin },
  { href: "/admin/payment-methods", label: "Payment", icon: CreditCard },
  { href: "/admin/invoices", label: "Invoices", icon: Receipt },
  { href: "/admin/wallet/topups", label: "Wallet Top-up", icon: Wallet },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/domain", label: "Domain", icon: Globe2 },
  { href: "/admin/dns-providers", label: "DNS Provider", icon: Cloud },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
  { href: "/admin/email-log", label: "Email Log", icon: Mail },
];

function getInitials(name: string, email: string) {
  if (name) return name.slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    api<Me>("/api/v1/auth/me")
      .then((u) => {
        if (u.role !== "admin") {
          router.replace("/dashboard");
          return;
        }
        setMe(u);
      })
      .catch(() => {
        clearTokens();
        router.replace("/login");
      })
      .finally(() => setReady(true));
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <span className="text-sm">Memeriksa sesi…</span>
        </div>
      </div>
    );
  }
  if (!me) return null;

  function logout() {
    clearTokens();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Sidebar — sticky ke viewport supaya user footer (Keluar) selalu
          terlihat tanpa perlu scroll seluruh halaman. Nav di tengah punya
          scroll area sendiri kalau daftar menu lebih panjang dari layar. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-[#0f1117] text-slate-100 md:flex">
        {/* Brand — pinned di atas */}
        <div className="shrink-0 px-5 py-5">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-md">
              <ShieldCheck className="size-4 text-primary-foreground" />
            </div>
            <span className="text-base font-bold tracking-tight">
              Web<span className="text-primary">Builder</span>
            </span>
          </Link>
          <div className="mt-3 flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
              Admin Console
            </span>
          </div>
        </div>

        <Separator className="shrink-0 bg-white/5" />

        {/* Navigation — scrollable independen. min-h-0 wajib supaya flex
            child boleh shrink di bawah content size (browser default:
            min-height:auto = ukuran isi). Tanpa ini, scroll tidak aktif. */}
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3 pt-4 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,.15)_transparent]">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Menu
          </p>
          {nav.map((n) => {
            const active =
              n.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-primary/15 text-primary shadow-sm"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                )}
              >
                <n.icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    active ? "text-primary" : "text-slate-500 group-hover:text-slate-300",
                  )}
                />
                <span>{n.label}</span>
                {active && (
                  <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}

          <div className="pt-2">
            <Separator className="mb-2 bg-white/5" />
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Navigasi
            </p>
            <Link
              href="/dashboard"
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-all hover:bg-white/5 hover:text-slate-100"
            >
              <ArrowLeft className="size-4 shrink-0 text-slate-500 transition-colors group-hover:text-slate-300" />
              Kembali ke Dashboard
            </Link>
          </div>
        </nav>

        {/* User footer — pinned di bawah */}
        <Separator className="shrink-0 bg-white/5" />
        <div className="shrink-0 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
              {getInitials(me.name, me.email)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">
                {me.name || "Admin"}
              </p>
              <p className="truncate text-xs text-slate-500">{me.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="mt-1 w-full justify-start gap-2 text-red-600 hover:bg-red-600 hover:text-slate-100"
          >
            <LogOut className="size-4 mr-2" />
            Keluar
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex h-14 shrink-0 items-center border-b bg-background/80 px-6 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground transition-colors">Admin</Link>
            {pathname !== "/admin" && (
              <>
                <span>/</span>
                <span className="font-medium text-foreground capitalize">
                  {pathname.split("/").pop()}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-x-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

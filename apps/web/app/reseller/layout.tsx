"use client";

// Reseller portal layout — auth gate + sidebar nav.
// Role gate: hanya reseller aktif yang boleh — kalau bukan, redirect ke /login
// atau /dashboard tergantung role.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  ChevronDown,
  Code2,
  Files,
  Globe2,
  Home,
  LogOut,
  Receipt,
  Settings,
  Store,
  Users,
  UserSquare2,
  UsersRound,
  Wallet,
} from "lucide-react";
import { api, clearTokens, getAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Me = {
  id: string;
  email: string;
  name?: string;
  role: string;
  reseller_display_name: string;
  reseller_status: string;
};

function getInitials(name: string | undefined, email: string, fallback: string): string {
  const source = (name || fallback || email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

const NAV = [
  { href: "/reseller/dashboard", label: "Dashboard", icon: Briefcase },
  { href: "/reseller/clients", label: "Klien", icon: Users },
  { href: "/reseller/team", label: "Tim (Agent)", icon: UsersRound },
  { href: "/reseller/domains", label: "Domain", icon: Globe2 },
  { href: "/reseller/wallet", label: "Wallet", icon: Wallet },
  { href: "/reseller/pricing", label: "Harga Jual", icon: Code2 },
  { href: "/reseller/invoices", label: "Invoice", icon: Receipt },
  { href: "/reseller/documents", label: "Dokumen", icon: Files },
  { href: "/reseller/collaborators", label: "Kolaborator", icon: UserSquare2 },
  { href: "/reseller/settings", label: "Pengaturan", icon: Settings },
] as const;

export default function ResellerLayout({ children }: { children: React.ReactNode }) {
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
        // Role gate: hanya reseller aktif yang boleh di sini.
        if (u.role !== "reseller") {
          // Redirect sesuai role
          if (u.role === "admin") router.replace("/admin");
          else if (u.role === "agent") router.replace("/agent/dashboard");
          else router.replace("/dashboard");
          return;
        }
        if (u.reseller_status !== "active") {
          // Backend should block login for non-active, but just in case:
          clearTokens();
          router.replace("/login");
          return;
        }
        setMe(u);
        setReady(true);
      })
      .catch(() => {
        clearTokens();
        router.replace("/login");
      });
  }, [router]);

  // Hooks must be called before any early return — memo derivation of
  // active nav label runs regardless of auth state; only pathname is needed.
  const activeLabel = useMemo(() => {
    const hit = NAV.find(
      (n) => pathname === n.href || pathname?.startsWith(n.href + "/"),
    );
    return hit?.label ?? "Reseller";
  }, [pathname]);

  if (!ready || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Memuat…
      </div>
    );
  }

  function logout() {
    clearTokens();
    router.replace("/login");
  }

  const initials = getInitials(me.name, me.email, me.reseller_display_name);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          {/* Brand + breadcrumb — link ke /reseller/dashboard bukan / supaya
              user tidak accidentally keluar dari portal saat klik logo. */}
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/reseller/dashboard"
              className="group flex items-center gap-2.5"
              aria-label="Ke dashboard reseller"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm transition-transform group-hover:scale-105">
                <Briefcase className="size-4" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">
                    {me.reseller_display_name}
                  </span>
                  <span
                    className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                    title="Aktif"
                    aria-label="Reseller aktif"
                  />
                </div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Reseller Portal
                </div>
              </div>
            </Link>

            {/* Breadcrumb page label — hidden di mobile supaya header tetap tight. */}
            <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
              <span aria-hidden="true">/</span>
              <span className="font-medium text-foreground">{activeLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Ke situs publik — icon-only di mobile, label kelihatan di md+. */}
            {/* Agent/reseller are promoted users: they still own sites from
                before, so keep a way back to the client dashboard. */}
            <Button variant="outline" size="sm" asChild className="gap-1.5">
              <Link href="/dashboard">
                <Store className="size-4" />
                <span className="hidden sm:inline">Toko Saya</span>
              </Link>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              asChild
              className="hidden gap-1.5 text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              <Link href="/" target="_blank" rel="noopener noreferrer">
                <Home className="size-4" />
                <span className="hidden md:inline">Beranda</span>
              </Link>
            </Button>

            {/* User menu — dropdown yang include email + shortcut ke settings. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border bg-card px-1.5 py-1 text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Menu akun"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                    {initials}
                  </span>
                  <span className="hidden max-w-[10rem] truncate pr-1 text-xs font-medium text-foreground sm:inline">
                    {me.name || me.email.split("@")[0]}
                  </span>
                  <ChevronDown className="mr-1 size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="normal-case">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Masuk sebagai
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {me.name || me.reseller_display_name}
                    </span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {me.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">
                    <Store className="size-3.5" />
                    Toko Saya
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/reseller/settings">
                    <Settings className="size-3.5" />
                    Pengaturan
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/" target="_blank" rel="noopener noreferrer">
                    <Home className="size-3.5" />
                    Beranda publik
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => logout()}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <LogOut className="size-3.5" />
                  Keluar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 md:grid-cols-[220px_1fr]">
        <aside className="md:sticky md:top-8 md:self-start">
          <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

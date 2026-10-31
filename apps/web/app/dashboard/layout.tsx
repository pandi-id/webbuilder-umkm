"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LogOut,
  Mail,
  Loader2,
  User,
  ChevronDown,
  Globe2,
} from "lucide-react";
import { api, clearTokens, getAccessToken } from "@/lib/api";
import { portalForRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Me = {
  id: string;
  email: string;
  name: string;
  role: string;
  email_verified_at?: string | null;
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    api<Me>("/api/v1/auth/me")
      .then(setMe)
      .catch(() => {
        clearTokens();
        router.replace("/login");
      })
      .finally(() => setReady(true));
  }, [router]);

  if (!ready) {
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

  // Reseller/agent/admin keep a second portal; everyone else gets null here.
  const portal = portalForRole(me?.role);

  return (
    <div className="min-h-screen bg-muted/30">
      {me && !me.email_verified_at && <VerifyBanner />}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            Web<span className="text-primary">Builder</span>
          </Link>
          <div className="flex items-center gap-2">
            {portal && (
              <Button variant="outline" size="sm" asChild className="gap-1.5">
                <Link href={portal.href}>
                  <portal.icon className="size-4" />
                  <span className="hidden sm:inline">{portal.short}</span>
                </Link>
              </Button>
            )}
            {me && <UserMenu me={me} onLogout={logout} />}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

// UserMenu — trigger avatar + email → dropdown dengan quick actions.
// Sengaja compact di trigger (avatar + email di sm+) supaya header tidak
// crowded; detail (nama, role) muncul di label dropdown.
function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const portal = portalForRole(me.role);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border bg-background pr-2 pl-1 py-1 text-sm transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
          aria-label="Menu akun"
        >
          <Avatar name={me.name} email={me.email} />
          <span className="hidden max-w-[180px] truncate text-xs font-medium text-muted-foreground sm:inline">
            {me.email}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        {/* Identity block */}
        <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
          <Avatar name={me.name} email={me.email} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me.name || "Pengguna"}</div>
            <div className="truncate text-xs text-muted-foreground">{me.email}</div>
            {portal && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <portal.icon className="size-2.5" />
                {me.role}
              </div>
            )}
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Akun</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <User className="size-4 text-muted-foreground" />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/domains">
            <Globe2 className="size-4 text-muted-foreground" />
            Domain Saya
          </Link>
        </DropdownMenuItem>

        {portal && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{portal.label}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={portal.href}>
                <portal.icon className="size-4 text-muted-foreground" />
                Buka {portal.label}
              </Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onLogout}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="size-4" />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Avatar({
  name,
  email,
  size = "sm",
}: {
  name: string;
  email: string;
  size?: "sm" | "lg";
}) {
  const initials = getInitials(name, email);
  const cls = size === "lg" ? "size-10 text-sm" : "size-7 text-[11px]";
  return (
    <div
      className={
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 font-bold text-primary-foreground " +
        cls
      }
    >
      {initials}
    </div>
  );
}

function getInitials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function VerifyBanner() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "err">("idle");
  const [msg, setMsg] = useState("");

  async function resend() {
    setState("sending");
    try {
      await api<{ ok: boolean }>("/api/v1/auth/email/resend", { method: "POST", body: "{}" });
      setState("sent");
    } catch (e) {
      setMsg((e as Error).message);
      setState("err");
    }
  }

  return (
    <div className="border-b border-amber-500/30 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Mail className="size-4 shrink-0" />
          <span>
            Email Anda belum diverifikasi. Cek inbox untuk link verifikasi.
          </span>
        </div>
        <div>
          {state === "idle" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={resend}
              className="h-7 text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/30"
            >
              Kirim ulang
            </Button>
          )}
          {state === "sending" && (
            <span className="flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" />
              Mengirim…
            </span>
          )}
          {state === "sent" && <span className="text-xs">Link sudah dikirim ulang.</span>}
          {state === "err" && <span className="text-xs">Gagal: {msg}</span>}
        </div>
      </div>
    </div>
  );
}

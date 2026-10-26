"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Files,
  Globe2,
  Home,
  ImageIcon,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Newspaper,
  Package,
  Palette,
  Rocket,
  Settings,
  ShieldCheck,
  SquarePen,
  Store,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { api, clearTokens, errMessage, getAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SITE_STATUS_EVENT,
  emitSiteStatus,
  type SiteStatusDetail,
} from "@/components/site-dashboard/utils";
import { cn } from "@/lib/utils";

type Site = { id: string; name: string; slug: string; status: string };

type Me = {
  id: string;
  email: string;
  name: string;
  role: string;
};

type NavItem = {
  // Path segment after /sites/:id ("" = overview).
  segment: string;
  label: string;
  icon: React.ElementType;
};

type NavSection = { label: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Toko",
    items: [
      { segment: "", label: "Ringkasan", icon: LayoutDashboard },
      { segment: "products", label: "Produk", icon: Package },
      { segment: "forms", label: "Pesan Masuk", icon: Inbox },
      { segment: "analytics", label: "Statistik", icon: BarChart3 },
    ],
  },
  {
    label: "Konten",
    items: [
      { segment: "editor", label: "Editor", icon: SquarePen },
      { segment: "pages", label: "Halaman", icon: Files },
      { segment: "blog", label: "Artikel", icon: Newspaper },
      { segment: "assets", label: "Aset", icon: ImageIcon },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { segment: "theme", label: "Tampilan", icon: Palette },
      { segment: "domains", label: "Domain", icon: Globe2 },
    ],
  },
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "": { title: "Ringkasan", subtitle: "Pantau toko online Anda dalam sekilas" },
  products: { title: "Produk", subtitle: "Kelola katalog, harga, dan stok produk" },
  forms: { title: "Pesan Masuk", subtitle: "Pesan dan pertanyaan dari calon pembeli" },
  analytics: { title: "Statistik", subtitle: "Lihat jumlah pengunjung dan halaman terpopuler" },
  editor: { title: "Editor", subtitle: "Susun halaman toko dengan drag-and-drop" },
  pages: { title: "Halaman", subtitle: "Kelola daftar halaman website toko" },
  blog: { title: "Artikel", subtitle: "Tulis kabar, promo, dan tips untuk pelanggan" },
  assets: { title: "Aset", subtitle: "Kelola foto produk dan berkas toko" },
  theme: { title: "Tampilan", subtitle: "Atur warna, font, dan template toko" },
  domains: { title: "Domain", subtitle: "Kelola alamat toko dan hubungkan domain .id Anda" },
  usage: { title: "Pemakaian", subtitle: "Kuota halaman dan penyimpanan toko" },
  members: { title: "Anggota", subtitle: "Atur siapa saja yang ikut mengelola toko" },
  export: { title: "Ekspor", subtitle: "Unduh website toko sebagai HTML statis" },
  code: { title: "Kode Kustom", subtitle: "Sisipkan kode tambahan ke website toko" },
};

function currentSegment(pathname: string, sid: string): string {
  return pathname.replace(`/sites/${sid}`, "").replace(/^\//, "").split("/")[0] ?? "";
}

// Persist sidebar collapse across reloads.
const SIDEBAR_COLLAPSED_KEY = "site_sidebar_collapsed";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const [site, setSite] = useState<Site | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    api<Site>(`/api/v1/sites/${params.id}`)
      .then(setSite)
      .catch(() => {
        clearTokens();
        router.replace("/login");
      });
    api<Me>("/api/v1/auth/me").then(setMe).catch(() => {});
  }, [params.id, router]);

  // Client-only read avoids hydration mismatch; default is expanded.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // localStorage disabled / private mode — keep default.
    }
  }, []);

  // Overview page can publish too; keep the header button in sync.
  useEffect(() => {
    function onStatus(e: Event) {
      const d = (e as CustomEvent<SiteStatusDetail>).detail;
      if (!d) return;
      setSite((prev) => (prev && prev.id === d.siteId ? { ...prev, status: d.status } : prev));
    }
    window.addEventListener(SITE_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(SITE_STATUS_EVENT, onStatus);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore write failure
      }
      return next;
    });
  }

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const sid = params.id;
  const segment = currentSegment(pathname, sid);
  const meta = TITLES[segment] ?? TITLES[""];
  const isPublished = site?.status === "published";

  async function publish() {
    if (!site || publishing || isPublished) return;
    setPublishing(true);
    try {
      const updated = await api<Site>(`/api/v1/sites/${site.id}/publish`, { method: "POST" });
      setSite(updated);
      emitSiteStatus(site.id, updated?.status ?? "published");
      toast.success("Toko berhasil dipublikasikan");
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setPublishing(false);
    }
  }

  function logout() {
    clearTokens();
    router.replace("/login");
  }

  // Kept in JS so the floating toggle and main margin stay aligned.
  const sidebarWidth = collapsed ? 72 : 256;

  return (
    <div className="min-h-screen bg-muted/30">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto border-r bg-card px-3 py-5 transition-[transform,width] duration-200 lg:translate-x-0",
          collapsed ? "lg:w-[72px] lg:px-2" : "lg:w-64",
          drawerOpen ? "translate-x-0 shadow-xl" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <Link
          href={`/sites/${sid}`}
          className={cn(
            "flex items-center gap-3 px-2 pb-5",
            collapsed && "lg:justify-center lg:px-0",
          )}
          title={collapsed ? site?.name ?? "Dashboard Toko" : undefined}
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Store className="size-5" />
          </div>
          <div className={cn("min-w-0", collapsed && "lg:hidden")}>
            <div className="truncate text-sm font-semibold">{site?.name ?? "Dashboard Toko"}</div>
            <div className="text-xs text-muted-foreground">Website UMKM</div>
          </div>
        </Link>

        <nav className="space-y-5" aria-label="Menu toko">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div
                className={cn(
                  "px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80",
                  collapsed && "lg:hidden",
                )}
              >
                {section.label}
              </div>
              {collapsed && <div className="mx-3 mb-2 hidden border-t lg:block" />}
              <div className="grid gap-0.5">
                {section.items.map((item) => {
                  const href = item.segment ? `/sites/${sid}/${item.segment}` : `/sites/${sid}`;
                  const active = segment === item.segment;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.segment || "overview"}
                      href={href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        collapsed && "lg:justify-center lg:px-0 lg:py-2.5",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto pt-5">
          <Link
            href="/dashboard"
            title={collapsed ? "Semua Toko" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              collapsed && "lg:justify-center lg:px-0",
            )}
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span className={cn(collapsed && "lg:hidden")}>Semua Toko</span>
          </Link>
        </div>
      </aside>

      {/* Desktop-only collapse toggle; mobile uses the drawer. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Buka sidebar" : "Ciutkan sidebar"}
        title={collapsed ? "Buka sidebar" : "Ciutkan sidebar"}
        className="fixed top-[60px] z-50 hidden size-7 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition-[left] hover:text-foreground lg:grid"
        style={{ left: `${sidebarWidth - 14}px` }}
      >
        {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
      </button>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/30 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div
        className={cn("transition-[margin] duration-200", collapsed ? "lg:ml-[72px]" : "lg:ml-64")}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDrawerOpen((v) => !v)}
            className="size-9 shrink-0 lg:hidden"
            aria-label="Buka menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="mr-auto min-w-0">
            <div className="truncate text-base font-semibold">{meta.title}</div>
            <div className="hidden truncate text-xs text-muted-foreground sm:block">
              {meta.subtitle}
            </div>
          </div>
          {isPublished ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="size-4" />
              <span className="hidden sm:inline">Dipublikasikan</span>
            </span>
          ) : (
            <Button
              size="sm"
              onClick={publish}
              disabled={!site || publishing}
              className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {publishing ? <Loader2 className="animate-spin" /> : <Rocket />}
              <span className="hidden sm:inline">
                {publishing ? "Mempublikasikan…" : "Publikasikan"}
              </span>
            </Button>
          )}
          {me && <UserMenu me={me} onLogout={logout} />}
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

// UserMenu — sama dengan dashboard header (apps/web/app/dashboard/layout.tsx).
// Trigger compact (avatar + email) → dropdown identitas + quick actions.
function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-2 text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Menu akun"
        >
          <Avatar name={me.name} email={me.email} />
          <span className="hidden max-w-[180px] truncate text-xs font-medium text-muted-foreground md:inline">
            {me.email}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
          <Avatar name={me.name} email={me.email} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me.name || "Pengguna"}</div>
            <div className="truncate text-xs text-muted-foreground">{me.email}</div>
            {me.role === "admin" && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <ShieldCheck className="size-2.5" />
                Admin
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
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <Home className="size-4 text-muted-foreground" />
            Semua Toko
          </Link>
        </DropdownMenuItem>

        {me.role === "admin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Admin</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <Settings className="size-4 text-muted-foreground" />
                Admin Panel
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
        "flex shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground " +
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Users,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Globe2,
  CalendarDays,
  SortAsc,
  AlertCircle,
  Ban,
  CircleCheck,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  PromoteAdminDialog,
  SuspendUserDialog,
  demoteAdmin,
  unsuspendUser,
  type AccessTarget,
} from "@/components/admin/UserAccessDialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pagination, useDebounced, type PaginatedResult } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  // "user" can still appear on accounts demoted before the role fix.
  role: "client" | "reseller" | "agent" | "admin" | "user";
  site_count: number;
  created_at: string;
  suspended_at?: string | null;
  suspended_reason?: string;
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  reseller: "Reseller",
  agent: "Agent",
  client: "Klien",
  user: "Klien",
};

const SORT_OPTIONS = [
  { value: "newest", label: "Terbaru Daftar" },
  { value: "oldest", label: "Terlama Daftar" },
  { value: "email_asc", label: "Email A → Z" },
  { value: "email_desc", label: "Email Z → A" },
  { value: "sites_desc", label: "Situs Terbanyak" },
];

function getInitials(name: string, email: string) {
  const src = name?.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-500/20 text-violet-600",
  "bg-blue-500/20 text-blue-600",
  "bg-emerald-500/20 text-emerald-600",
  "bg-amber-500/20 text-amber-600",
  "bg-rose-500/20 text-rose-600",
  "bg-cyan-500/20 text-cyan-600",
];

function avatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </TableCell>
      <TableCell><div className="h-5 w-16 rounded-full bg-muted animate-pulse" /></TableCell>
      <TableCell><div className="h-3 w-6 rounded bg-muted animate-pulse" /></TableCell>
      <TableCell><div className="h-3 w-20 rounded bg-muted animate-pulse" /></TableCell>
      <TableCell><div className="h-8 w-24 rounded bg-muted animate-pulse ml-auto" /></TableCell>
    </TableRow>
  );
}

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("newest");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 300);
  const [data, setData] = useState<PaginatedResult<AdminUser> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, sort]);

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "20", sort });
      if (debouncedQ) params.set("q", debouncedQ);
      const r = await api<PaginatedResult<AdminUser>>(`/api/v1/admin/users?${params}`);
      setData(r);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [page, debouncedQ, sort]);

  // Privilege changes live behind a menu + dialog: a one-click "Jadikan Admin"
  // sitting next to every row was one mis-click away from a new superuser.
  const [promoteTarget, setPromoteTarget] = useState<AccessTarget | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AccessTarget | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    api<{ id: string }>("/api/v1/auth/me")
      .then((m) => setMeId(m.id))
      .catch(() => {});
  }, []);

  async function runQuick(u: AdminUser, fn: (t: AccessTarget) => Promise<boolean>) {
    setActionLoading(u.id + "quick");
    try {
      if (await fn(u)) refresh();
    } finally {
      setActionLoading(null);
    }
  }

  async function remove(id: string, email: string) {
    if (!confirm(`Hapus akun ${email}?\n\nSemua situs miliknya juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
    setActionLoading(id + "delete");
    try {
      await api(`/api/v1/admin/users/${id}`, { method: "DELETE" });
      toast.success(`Akun ${email} berhasil dihapus.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  const users = data?.items ?? [];
  const adminCount = users.filter((u) => u.role === "admin").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10">
              <Users className="size-4 text-violet-600" />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Manajemen Pengguna
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Pengguna</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data
              ? `${data.total} akun terdaftar${adminCount > 0 ? ` · ${adminCount} admin di halaman ini` : ""}`
              : "Memuat data…"}
          </p>
        </div>

        {/* Stats chips */}
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-sm">
              <Users className="size-3.5 text-muted-foreground" />
              <span className="font-semibold">{data.total}</span>
              <span className="text-muted-foreground">total</span>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari email atau nama…"
            className="pl-9 h-9 bg-muted/40 border-transparent focus:border-input focus:bg-background transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <SortAsc className="size-4 text-muted-foreground" />
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-52 bg-muted/40 border-transparent focus:border-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Error */}
      {err && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span><span className="font-medium">Gagal memuat:</span> {err}</span>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden rounded-xl p-0 shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="pl-5 font-semibold text-foreground">Pengguna</TableHead>
              <TableHead className="font-semibold text-foreground">Role</TableHead>
              <TableHead className="font-semibold text-foreground">
                <div className="flex items-center gap-1.5">
                  <Globe2 className="size-3.5" /> Situs
                </div>
              </TableHead>
              <TableHead className="font-semibold text-foreground">
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" /> Bergabung
                </div>
              </TableHead>
              <TableHead className="pr-5 text-right font-semibold text-foreground">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              : users.map((u) => {
                  const isActing = actionLoading?.startsWith(u.id) ?? false;
                  return (
                    <TableRow
                      key={u.id}
                      className={`transition-colors ${isActing || loading ? "opacity-60" : ""}`}
                    >
                      {/* User column — clickable ke detail page */}
                      <TableCell className="pl-5 py-3">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="flex items-center gap-3 rounded-md transition-colors hover:opacity-90"
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(u.id)}`}
                          >
                            {getInitials(u.name, u.email)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium leading-tight hover:text-primary">
                              {u.name || <span className="text-muted-foreground italic">Tanpa nama</span>}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {u.email}
                            </p>
                          </div>
                        </Link>
                      </TableCell>

                      {/* Role + status */}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {u.role === "admin" ? (
                            <Badge className="gap-1 bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400 hover:bg-amber-500/20">
                              <ShieldCheck className="size-3" />
                              Admin
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <Users className="size-3" />
                              {ROLE_LABEL[u.role] ?? u.role}
                            </Badge>
                          )}
                          {u.suspended_at && (
                            <Badge
                              variant="destructive"
                              className="gap-1"
                              title={u.suspended_reason || "Ditangguhkan admin"}
                            >
                              <Ban className="size-3" />
                              Ditangguhkan
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      {/* Sites */}
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 tabular-nums text-sm">
                          <span className="font-semibold">{u.site_count}</span>
                          <span className="text-muted-foreground text-xs">situs</span>
                        </span>
                      </TableCell>

                      {/* Date */}
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="pr-5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="h-8 gap-1.5 text-xs text-primary hover:bg-blue-300 hover:text-blue-50"
                          >
                            <Link href={`/admin/users/${u.id}`}>Detail</Link>
                          </Button>
                          {u.id === meId ? (
                            <span className="px-2 text-xs text-muted-foreground">Anda</span>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="size-8 p-0"
                                  disabled={isActing}
                                  aria-label={`Aksi untuk ${u.email}`}
                                >
                                  {isActing ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <MoreHorizontal className="size-4" />
                                  )}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                {u.role === "admin" ? (
                                  <DropdownMenuItem onSelect={() => runQuick(u, demoteAdmin)}>
                                    <ShieldOff className="size-4 text-muted-foreground" />
                                    Turunkan dari admin
                                  </DropdownMenuItem>
                                ) : (
                                  <>
                                    {/* Only plain, active clients can be promoted —
                                        the API refuses the rest anyway. */}
                                    {(u.role === "client" || u.role === "user") && !u.suspended_at && (
                                      <DropdownMenuItem onSelect={() => setPromoteTarget(u)}>
                                        <ShieldCheck className="size-4 text-amber-600" />
                                        Jadikan admin…
                                      </DropdownMenuItem>
                                    )}
                                    {u.suspended_at ? (
                                      <DropdownMenuItem onSelect={() => runQuick(u, unsuspendUser)}>
                                        <CircleCheck className="size-4 text-emerald-600" />
                                        Aktifkan kembali
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem onSelect={() => setSuspendTarget(u)}>
                                        <Ban className="size-4 text-muted-foreground" />
                                        Tangguhkan akun…
                                      </DropdownMenuItem>
                                    )}
                                  </>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() => remove(u.id, u.email)}
                                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                >
                                  <Trash2 className="size-4" />
                                  Hapus akun
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

            {/* Empty state */}
            {users.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Users className="size-8 opacity-30" />
                    <p className="text-sm font-medium">
                      {debouncedQ ? `Tidak ada hasil untuk "${debouncedQ}"` : "Belum ada pengguna"}
                    </p>
                    {debouncedQ && (
                      <button
                        onClick={() => setQ("")}
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        Hapus pencarian
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {data && data.total_pages > 0 && (
          <div className="border-t bg-muted/20">
            <Pagination
              page={data.page}
              totalPages={data.total_pages}
              total={data.total}
              pageSize={data.page_size}
              onPage={setPage}
            />
          </div>
        )}
      </Card>

      <PromoteAdminDialog
        target={promoteTarget}
        onClose={() => setPromoteTarget(null)}
        onDone={refresh}
      />
      <SuspendUserDialog
        target={suspendTarget}
        onClose={() => setSuspendTarget(null)}
        onDone={refresh}
      />
    </div>
  );
}

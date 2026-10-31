"use client";

// Shared "Klien" table for the reseller and agent portals. Both list the
// clients assigned to the caller; only the labels and the URL prefix differ.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Globe2,
  Loader2,
  Mail,
  MailWarning,
  MoreHorizontal,
  Send,
  Unlink,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  resendClientInvite,
  unlinkClient,
  type ManagedClient,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BasePath = "/agent" | "/reseller";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// Activation reads from two independent facts, so say which one is missing
// instead of lumping everything into "belum accept".
function Activation({ c }: { c: ManagedClient }) {
  if (!c.has_login) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <Clock className="size-3" />
        Belum accept
      </span>
    );
  }
  if (!c.email_verified) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <MailWarning className="size-3" />
        Email belum diverifikasi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
      <CheckCircle2 className="size-3" />
      Aktif
    </span>
  );
}

export function ClientsList({
  basePath,
  title,
  description,
}: {
  basePath: BasePath;
  title: string;
  description: string;
}) {
  const [items, setItems] = useState<ManagedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toUnlink, setToUnlink] = useState<ManagedClient | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const res = await api<ManagedClient[]>(`/api/v1${basePath}/clients`);
      setItems(res ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  async function resend(c: ManagedClient) {
    setBusy(`resend-${c.client_id}`);
    try {
      await resendClientInvite(basePath, c.client_id);
      toast.success(`Undangan dikirim ulang ke ${c.email}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmUnlink() {
    if (!toUnlink) return;
    setBusy(`unlink-${toUnlink.client_id}`);
    try {
      await unlinkClient(basePath, toUnlink.client_id);
      toast.success(`${toUnlink.name || toUnlink.email} dilepas dari daftar klien Anda`);
      setToUnlink(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild className="gap-1.5">
          <Link href={`${basePath}/clients/new`}>
            <UserPlus className="size-4" />
            Tambah Klien
          </Link>
        </Button>
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <span>{err}</span>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Nama</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status Akses</TableHead>
                <TableHead>Aktivasi</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="w-0 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loading ? "opacity-60" : ""}>
              {loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="size-8 opacity-30" />
                      <p className="text-sm font-medium">Belum ada klien</p>
                      <p className="text-xs">
                        Tambahkan klien pertama untuk mulai kelola situs mereka.
                      </p>
                      <Button asChild size="sm" className="mt-3 gap-1.5">
                        <Link href={`${basePath}/clients/new`}>
                          <UserPlus className="size-4" />
                          Tambah Klien
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((c) => {
                  const rowBusy = busy?.endsWith(c.client_id) ?? false;
                  return (
                    <TableRow key={c.assignment_id}>
                      <TableCell className="font-medium">
                        {/* A real link, not just a menu entry: rows should be
                            clickable, and tooling scrapes this href. */}
                        <Link
                          href={`${basePath}/clients/${c.client_id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {c.name || (
                            <span className="text-muted-foreground">Tanpa nama</span>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1 font-mono text-xs">
                          <Mail className="size-3 text-muted-foreground" />
                          {c.email}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={c.access_status === "setup" ? "warning" : "success"}
                          className="text-xs"
                        >
                          {c.access_status === "setup" ? "Setup" : "Aktif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Activation c={c} />
                      </TableCell>
                      <TableCell>
                        {c.domain_count > 0 ? (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <Globe2 className="size-2.5" />
                            {c.domain_count}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(c.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* One primary action stays visible; the rest live in the
                            menu so the row never wraps onto a second line. */}
                        <div className="flex items-center justify-end gap-1.5">
                          {c.domain_count === 0 && (
                            <Button size="sm" asChild className="gap-1 whitespace-nowrap">
                              <Link href={`/sites/new-with-domain?for_client=${c.client_id}`}>
                                <Globe2 className="size-3" />
                                Beli Domain
                              </Link>
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="size-8 p-0"
                                aria-label={`Aksi untuk ${c.name || c.email}`}
                                disabled={rowBusy}
                              >
                                {rowBusy ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="size-4" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem asChild>
                                <Link href={`${basePath}/clients/${c.client_id}`}>
                                  <ArrowRight className="size-4 text-muted-foreground" />
                                  Lihat detail
                                </Link>
                              </DropdownMenuItem>
                              {/* Only an account with no login has an invitation
                                  left to accept. */}
                              {!c.has_login && (
                                <DropdownMenuItem onSelect={() => resend(c)}>
                                  <Send className="size-4 text-muted-foreground" />
                                  Kirim ulang undangan
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => setToUnlink(c)}
                                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              >
                                <Unlink className="size-4" />
                                Lepas dari daftar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!toUnlink} onOpenChange={(o) => !o && setToUnlink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lepas klien dari daftar Anda?</DialogTitle>
            <DialogDescription>
              {toUnlink?.name || toUnlink?.email} tidak akan muncul lagi di daftar klien
              Anda, dan Anda berhenti bisa mengelola domain atau situs atas nama mereka.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            Akun, situs, dan domain milik mereka <strong>tidak dihapus</strong> — mereka tetap
            bisa login seperti biasa. Anda bisa menambahkannya lagi nanti lewat email yang sama.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToUnlink(null)} disabled={!!busy}>
              Batal
            </Button>
            <Button variant="destructive" onClick={confirmUnlink} disabled={!!busy} className="gap-1.5">
              {busy?.startsWith("unlink-") ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlink className="size-4" />
              )}
              Lepas Klien
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

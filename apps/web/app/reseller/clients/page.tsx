"use client";

// Reseller > Klien — list klien + create dialog (Phase 2: invite-only,
// tanpa domain purchase). Phase 3 nanti extend dengan wizard beli domain.

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
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Client = {
  client_id: string;
  assignment_id: string;
  email: string;
  name: string;
  access_status: "setup" | "active" | "revoked";
  email_verified: boolean;
  created_at: string;
  domain_count: number;
};

export default function ResellerClientsPage() {
  const [items, setItems] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const res = await api<Client[]>("/api/v1/reseller/clients");
      setItems(res ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Klien</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Daftarkan klien baru — mereka akan terima email invite untuk aktifkan akun.
          </p>
        </div>
        <Button asChild className="gap-1.5">
          <Link href="/reseller/clients/new">
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
                <TableHead>Tanggal</TableHead>
                <TableHead className="w-0">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loading ? "opacity-60" : ""}>
              {loading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-14 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="size-8 opacity-30" />
                      <p className="text-sm font-medium">Belum ada klien</p>
                      <p className="text-xs">
                        Tambahkan klien pertama untuk mulai kelola situs mereka.
                      </p>
                      <Button asChild size="sm" className="mt-3 gap-1.5">
                        <Link href="/reseller/clients/new">
                          <UserPlus className="size-4" />
                          Tambah Klien
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((c) => (
                  <TableRow key={c.assignment_id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
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
                      {c.email_verified ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="size-3" />
                          Aktif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                          <Clock className="size-3" />
                          Belum accept
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(c.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {c.domain_count === 0 ? (
                          <Button size="sm" asChild className="gap-1 whitespace-nowrap">
                            <Link href={`/sites/new-with-domain?for_client=${c.client_id}`}>
                              <Globe2 className="size-3" />
                              Beli Domain
                            </Link>
                          </Button>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <Globe2 className="size-2.5" />
                            {c.domain_count} domain
                          </Badge>
                        )}
                        <Button size="sm" variant="outline" asChild className="gap-1 whitespace-nowrap">
                          <Link href={`/reseller/clients/${c.client_id}`}>
                            Detail
                            <ArrowRight className="size-3" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

    </div>
  );
}

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

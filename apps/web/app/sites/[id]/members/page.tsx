"use client";

// Site collaborators — Phase 4. Owner lihat + remove collab; collab lihat +
// leave.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Crown,
  Loader2,
  LogOut,
  Mail,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { InviteMemberDialog } from "@/components/collaborators/InviteMemberDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Member = {
  user_id: string;
  email: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  added_at: string;
};

type Me = { id: string };

export default function SiteMembersPage() {
  const params = useParams<{ id: string }>();
  const siteID = params.id;
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const [meRes, memRes] = await Promise.all([
        api<Me>("/api/v1/auth/me"),
        api<Member[]>(`/api/v1/sites/${siteID}/members`),
      ]);
      setMe(meRes);
      setMembers(memRes ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [siteID]);

  const myRole = members.find((m) => m.user_id === me?.id)?.role;
  const isOwner = myRole === "owner";

  async function remove(memberID: string) {
    if (!confirm("Yakin hapus akses collaborator ini?")) return;
    try {
      await api(`/api/v1/sites/${siteID}/members/${memberID}`, { method: "DELETE" });
      toast.success("Akses collaborator dihapus");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function leave() {
    if (!confirm("Yakin keluar dari situs ini? Anda akan kehilangan akses edit.")) return;
    try {
      await api(`/api/v1/sites/${siteID}/leave`, { method: "POST" });
      toast.success("Anda sudah keluar dari situs ini");
      window.location.href = "/dashboard";
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toast.error("Anda tidak bisa leave (mungkin owner)");
        return;
      }
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Kolaborator</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {isOwner
              ? "Orang yang Anda beri akses ke situs ini — rekan, staf, agen, atau reseller. Anda bisa cabut aksesnya kapan saja."
              : "Anggota tim di situs ini. Anda bisa keluar kalau tidak lagi terlibat."}
          </p>
        </div>
        {isOwner && (
          <Button onClick={() => setInviteOpen(true)} className="gap-1.5">
            <UserPlus className="size-4" />
            Undang Kolaborator
          </Button>
        )}
        {!isOwner && myRole && (
          <Button variant="outline" onClick={leave} className="gap-1.5 text-destructive">
            <LogOut className="size-4" />
            Keluar dari Situs
          </Button>
        )}
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
                <TableHead>Role</TableHead>
                <TableHead>Ditambah</TableHead>
                {isOwner && <TableHead className="w-0">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className={loading ? "opacity-60" : ""}>
              {loading && members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 5 : 4} className="py-14 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {m.role === "owner" && (
                          <Crown className="size-3.5 text-amber-500" />
                        )}
                        {m.name}
                        {m.user_id === me?.id && (
                          <span className="text-xs text-muted-foreground">(Anda)</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="flex items-center gap-1 font-mono text-xs">
                        <Mail className="size-3 text-muted-foreground" />
                        {m.email}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          m.role === "owner"
                            ? "success"
                            : m.role === "editor"
                              ? "secondary"
                              : "warning"
                        }
                        className="text-xs"
                      >
                        {roleLabel(m.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(m.added_at)}
                    </TableCell>
                    {isOwner && (
                      <TableCell>
                        {m.role !== "owner" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => remove(m.user_id)}
                            className="gap-1 text-destructive"
                          >
                            <Trash2 className="size-3" />
                            Hapus
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {isOwner && (
        <InviteMemberDialog
          siteId={siteID}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onAdded={refresh}
        />
      )}
    </div>
  );
}

function roleLabel(role: string): string {
  return { owner: "Pemilik", editor: "Editor", viewer: "Viewer" }[role] || role;
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

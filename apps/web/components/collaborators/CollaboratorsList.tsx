"use client";

// /settings/collaborators — client-side aggregate view. Client bisa lihat
// semua reseller/agent yang masih punya akses ke situs-situsnya + revoke
// dari sini (bukan harus buka tiap site).

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Mail,
  Trash2,
  Users,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { InviteMemberDialog } from "@/components/collaborators/InviteMemberDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Member = {
  user_id: string;
  email: string;
  name: string;
  role: "editor" | "viewer";
  added_at: string;
};

type SiteGroup = {
  site_id: string;
  site_name: string;
  site_slug: string;
  members: Member[];
};

export function CollaboratorsList() {
  const [groups, setGroups] = useState<SiteGroup[]>([]);
  const [inviteFor, setInviteFor] = useState<SiteGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const res = await api<SiteGroup[]>("/api/v1/collaborators");
      setGroups(res ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function remove(siteID: string, memberID: string, memberName: string) {
    if (
      !confirm(
        `Yakin cabut akses ${memberName} dari situs ini? Mereka tidak bisa lagi edit isi.`,
      )
    )
      return;
    try {
      await api(`/api/v1/sites/${siteID}/members/${memberID}`, { method: "DELETE" });
      toast.success("Akses dicabut");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <Users className="size-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Kolaborator</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Reseller / agent yang bantu Anda kelola situs. Cabut akses kalau
          sudah selesai handoff.
        </p>
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <span>{err}</span>
        </div>
      )}

      {loading && groups.length === 0 ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Memuat…
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
            <Users className="size-8 opacity-30" />
            <p className="text-sm font-medium">Belum ada kolaborator</p>
            <p className="max-w-md text-xs">
              Anda bisa mengundang rekan, staf, atau agen yang dipercaya lewat tab
              <strong> Anggota</strong> di situs yang bersangkutan. Reseller / agent
              yang membantu mendaftarkan domain juga otomatis mendapat akses editor.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.site_id}>
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{g.site_name}</h3>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">/{g.site_slug}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setInviteFor(g)}
                      className="gap-1.5"
                    >
                      <UserPlus className="size-3.5" />
                      Undang
                    </Button>
                    <Button size="sm" variant="ghost" asChild className="gap-1">
                      <Link href={`/sites/${g.site_id}/members`}>
                        Buka
                        <ExternalLink className="size-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
                <ul className="divide-y">
                  {g.members.map((m) => (
                    <li
                      key={m.user_id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Mail className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {m.name}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {m.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={m.role === "editor" ? "secondary" : "warning"}
                          className="text-xs"
                        >
                          {roleLabel(m.role)}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(g.site_id, m.user_id, m.name)}
                          className="gap-1 text-destructive"
                        >
                          <Trash2 className="size-3" />
                          Cabut
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {inviteFor && (
        <InviteMemberDialog
          siteId={inviteFor.site_id}
          open
          onOpenChange={(o) => !o && setInviteFor(null)}
          onAdded={() => {
            setInviteFor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function roleLabel(role: string): string {
  return { editor: "Editor", viewer: "Viewer" }[role] || role;
}

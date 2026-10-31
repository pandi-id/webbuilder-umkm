"use client";

// MyCollaborationsList — sites the caller helps run but does not own (agent or
// reseller on a client's shop, or anyone granted editor/viewer access).
// Endpoint: GET /api/v1/collaborations.
//
// Deliberately detailed: once you manage more than a handful, "whose site is
// this and is it live?" is the only question that matters, so owner, status,
// domain and last activity are all on the card.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe2,
  LayoutDashboard,
  Loader2,
  Search,
  SquarePen,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounced } from "@/components/Pagination";

type Collaboration = {
  site_id: string;
  site_name: string;
  site_slug: string;
  owner_id: string;
  owner_email: string;
  owner_name: string;
  role: "editor" | "viewer";
  added_at: string;
  site_status: string;
  hostname: string;
  updated_at: string;
};

const ROLE: Record<string, { label: string; hint: string }> = {
  editor: { label: "Editor", hint: "Anda bisa mengubah isi situs ini" },
  viewer: { label: "Viewer", hint: "Anda hanya bisa melihat situs ini" },
};

function initials(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (s.trim().slice(0, 2) || "?").toUpperCase();
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

function StatusBadge({ status }: { status: string }) {
  if (status === "published") {
    return (
      <Badge variant="success" className="gap-1 text-[10px]">
        <CheckCircle2 className="size-2.5" />
        Dipublikasikan
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-[10px]">
      <Clock className="size-2.5" />
      {status === "archived" ? "Diarsipkan" : "Draf"}
    </Badge>
  );
}

// `heading` drops to h2 when this sits under another section (the settings
// page stacks both directions of collaboration); on its own page it is the h1.
export function MyCollaborationsList({
  heading = "h1",
}: {
  heading?: "h1" | "h2";
} = {}) {
  const Heading = heading;
  const [items, setItems] = useState<Collaboration[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 300);

  useEffect(() => {
    api<Collaboration[]>("/api/v1/collaborations")
      .then((res) => setItems(res ?? []))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Match on site, owner name and owner email — all three are how people
  // actually look for "that one client's shop".
  const shown = useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) =>
      [it.site_name, it.owner_name, it.owner_email, it.hostname]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, debouncedQ]);

  const liveCount = items.filter((i) => i.site_status === "published").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <Heading
              className={
                heading === "h1"
                  ? "text-2xl font-bold tracking-tight"
                  : "text-xl font-bold tracking-tight"
              }
            >
              Situs yang saya kelola
            </Heading>
          </div>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Memuat…"
              : items.length === 0
                ? "Situs milik orang lain yang Anda bantu kelola akan muncul di sini."
                : `${items.length} situs · ${liveCount} sudah tayang`}
          </p>
        </div>
        {items.length > 3 && (
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari situs atau pemilik…"
              className="h-9 border-transparent bg-muted/40 pl-9 focus:border-input focus:bg-background"
            />
          </div>
        )}
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <span>{err}</span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
          <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
            <Users className="size-8 opacity-30" />
            <p className="text-sm font-medium">Belum ada situs yang dikelola</p>
            <p className="max-w-md text-xs">
              Ketika Anda membeli domain dan membuat situs untuk klien, klien otomatis
              menjadi pemilik dan Anda mendapat akses editor untuk membantu mengisi konten.
            </p>
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Tidak ada hasil untuk &quot;{debouncedQ}&quot;
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((it) => {
            const role = ROLE[it.role] ?? { label: it.role, hint: "" };
            const live = it.site_status === "published" && it.hostname;
            return (
              <Card key={it.site_id} className="overflow-hidden transition-shadow hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{it.site_name}</h3>
                        <StatusBadge status={it.site_status} />
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Globe2 className="size-3 shrink-0" />
                        {it.hostname ? (
                          <span className="truncate font-mono">{it.hostname}</span>
                        ) : (
                          <span className="italic">Belum ada domain aktif</span>
                        )}
                      </p>
                    </div>
                    <Badge
                      variant={it.role === "editor" ? "secondary" : "outline"}
                      className="shrink-0 text-[10px]"
                      title={role.hint}
                    >
                      {role.label}
                    </Badge>
                  </div>

                  {/* Whose site this is — the question the old list answered
                      with one grey line of text. */}
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                      {initials(it.owner_name || it.owner_email)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {it.owner_name || "Tanpa nama"}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {it.owner_email}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Diperbarui {formatDate(it.updated_at)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {live && (
                        <Button variant="ghost" size="sm" asChild className="h-8 gap-1.5">
                          <a href={`https://${it.hostname}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="size-3.5" />
                            Lihat
                          </a>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild className="h-8 gap-1.5">
                        <Link href={`/sites/${it.site_id}`}>
                          <LayoutDashboard className="size-3.5" />
                          Kelola
                        </Link>
                      </Button>
                      {it.role === "editor" && (
                        <Button size="sm" asChild className="h-8 gap-1.5">
                          <Link href={`/sites/${it.site_id}/editor`}>
                            <SquarePen className="size-3.5" />
                            Editor
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

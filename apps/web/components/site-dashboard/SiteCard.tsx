import Link from "next/link";
import { ExternalLink, Globe2, LayoutDashboard, SquarePen, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtDate, initials, themeGradient, type ThemeJson } from "./utils";

export type SiteCardData = {
  id: string;
  name: string;
  slug: string;
  status: string;
  updated_at: string;
  theme?: ThemeJson | null;
  role?: string;
};

const STATUS: Record<string, { label: string; variant: "success" | "secondary" | "outline" }> = {
  published: { label: "Dipublikasikan", variant: "success" },
  draft: { label: "Draf", variant: "secondary" },
  archived: { label: "Diarsipkan", variant: "outline" },
};

export function SiteCard({ site, domain }: { site: SiteCardData; domain?: string | null }) {
  const st = STATUS[site.status] ?? STATUS.draft;
  const liveURL = domain ? `https://${domain}` : null;

  return (
    <Card className="group flex flex-col overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:shadow-md">
      {/* Preview area — theme gradient + store initial, since we have no screenshots. */}
      <Link
        href={`/sites/${site.id}`}
        className="relative block aspect-[16/7] overflow-hidden"
        style={{ background: themeGradient(site.theme) }}
        aria-label={`Kelola ${site.name}`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.35),transparent_45%)]" />
        <div className="absolute -bottom-10 -right-6 size-32 rounded-full bg-white/10" />
        <div className="absolute inset-x-4 bottom-4 flex items-end gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/95 text-base font-bold text-slate-900 shadow-sm">
            {initials(site.name)}
          </div>
          <div className="min-w-0 pb-0.5 text-white drop-shadow-sm">
            <div className="truncate text-xs font-medium opacity-90">
              {domain ?? "Domain belum terhubung"}
            </div>
          </div>
        </div>
        <Badge variant={st.variant} className="absolute right-3 top-3 shadow-sm">
          {st.label}
        </Badge>
      </Link>

      <div className="flex flex-1 flex-col gap-1 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold leading-tight">{site.name}</h3>
          {site.role && site.role !== "owner" && (
            <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
              <Users className="size-3" />
              {site.role === "editor" ? "Editor" : "Pemantau"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Globe2 className="size-3.5 shrink-0" />
          <span className="truncate">{domain ?? "Belum ada domain aktif"}</span>
        </div>
        <div className="text-xs text-muted-foreground">Diperbarui {fmtDate(site.updated_at)}</div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 border-t bg-muted/30 p-2.5">
        <Button size="sm" asChild className="h-8 px-2 text-xs">
          <Link href={`/sites/${site.id}`}>
            <LayoutDashboard className="!size-3.5" />
            Kelola
          </Link>
        </Button>
        <Button size="sm" variant="outline" asChild className="h-8 px-2 text-xs">
          <Link href={`/sites/${site.id}/editor`}>
            <SquarePen className="!size-3.5" />
            Editor
          </Link>
        </Button>
        {liveURL ? (
          <Button size="sm" variant="outline" asChild className="h-8 px-2 text-xs">
            <a href={liveURL} target="_blank" rel="noopener noreferrer" title={liveURL}>
              <ExternalLink className="!size-3.5" />
              Lihat
            </a>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled
            className="h-8 px-2 text-xs"
            title="Domain belum aktif"
          >
            <ExternalLink className="!size-3.5" />
            Lihat
          </Button>
        )}
      </div>
    </Card>
  );
}

export function SiteCardSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="aspect-[16/7] animate-pulse bg-muted/50" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted/50" />
        <div className="h-3 w-1/2 animate-pulse rounded-md bg-muted/50" />
        <div className="h-3 w-1/3 animate-pulse rounded-md bg-muted/50" />
      </div>
      <div className="grid grid-cols-3 gap-1.5 border-t p-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-muted/50" />
        ))}
      </div>
    </Card>
  );
}

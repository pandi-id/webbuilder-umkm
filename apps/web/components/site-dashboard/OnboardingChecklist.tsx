import Link from "next/link";
import { ArrowRight, Check, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type ChecklistItem = {
  key: string;
  title: string;
  description: string;
  done: boolean;
  cta: string;
  // Either a link or an inline action (e.g. publish) — action wins if set.
  href?: string;
  onAction?: () => void;
  busy?: boolean;
};

export function OnboardingChecklist({
  items,
  loading,
}: {
  items: ChecklistItem[];
  loading?: boolean;
}) {
  const doneCount = items.filter((i) => i.done).length;
  const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const allDone = !loading && doneCount === items.length;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {allDone ? "Toko Anda siap berjualan" : "Siapkan toko Anda"}
            </CardTitle>
            <CardDescription className="mt-1">
              {allDone
                ? "Semua langkah awal sudah selesai. Bagikan link toko ke pelanggan Anda."
                : "Selesaikan langkah berikut supaya toko siap dikunjungi pembeli."}
            </CardDescription>
          </div>
          {loading ? (
            <div className="h-6 w-12 animate-pulse rounded-md bg-muted/50" />
          ) : (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
              {doneCount}/{items.length}
            </span>
          )}
        </div>
        <Progress
          value={loading ? 0 : percent}
          className="mt-3 h-2 bg-muted"
          indicatorClassName={allDone ? "bg-emerald-500" : "bg-primary"}
          aria-label={`Kemajuan persiapan toko ${percent}%`}
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {loading
          ? Array.from({ length: items.length || 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-muted/50" />
            ))
          : items.map((item, idx) => <ChecklistRow key={item.key} item={item} index={idx + 1} />)}
        {allDone && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            <PartyPopper className="size-4 shrink-0" />
            Mantap! Teruskan dengan menambah produk dan menulis artikel promosi.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChecklistRow({ item, index }: { item: ChecklistItem; index: number }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-colors",
        item.done ? "bg-muted/30" : "bg-card hover:border-primary/40",
      )}
    >
      <div
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
          item.done
            ? "bg-emerald-500 text-white"
            : "border-2 border-dashed border-muted-foreground/40 text-muted-foreground",
        )}
        aria-hidden
      >
        {item.done ? <Check className="size-4" /> : index}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm font-medium",
            item.done && "text-muted-foreground line-through decoration-muted-foreground/40",
          )}
        >
          {item.title}
        </div>
        {!item.done && (
          <div className="mt-0.5 text-xs text-muted-foreground">{item.description}</div>
        )}
      </div>
      {!item.done &&
        (item.onAction ? (
          <Button size="sm" onClick={item.onAction} disabled={item.busy} className="shrink-0">
            {item.busy && <Loader2 className="animate-spin" />}
            {item.cta}
          </Button>
        ) : item.href ? (
          <Button size="sm" variant="outline" asChild className="shrink-0">
            <Link href={item.href} aria-label={item.cta}>
              <span className="hidden sm:inline">{item.cta}</span>
              <ArrowRight />
            </Link>
          </Button>
        ) : null)}
    </div>
  );
}

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtNumber } from "./utils";

type Props = {
  label: string;
  // null = endpoint failed; render "—" instead of a misleading 0.
  value: number | null;
  hint?: string;
  icon: React.ElementType;
  tint: string;
  href: string;
  loading?: boolean;
};

export function StatCard({ label, value, hint, icon: Icon, tint, href, loading }: Props) {
  return (
    <Link href={href} className="group block focus-visible:outline-none">
      <Card className="h-full p-4 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tint)}>
            <Icon className="size-5" />
          </div>
          <ArrowUpRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
        </div>
        <div className="mt-4 text-sm text-muted-foreground">{label}</div>
        {loading ? (
          <div className="mt-1.5 space-y-2">
            <div className="h-7 w-16 animate-pulse rounded-md bg-muted/50" />
            <div className="h-3 w-24 animate-pulse rounded-md bg-muted/50" />
          </div>
        ) : (
          <>
            <div className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">
              {value === null ? "—" : fmtNumber(value)}
            </div>
            {hint && (
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {value === null ? "Data belum tersedia" : hint}
              </div>
            )}
          </>
        )}
      </Card>
    </Link>
  );
}

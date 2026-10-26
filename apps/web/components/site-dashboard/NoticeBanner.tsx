"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeRow = {
  key: string;
  href: string;
  domain: string;
  badge: React.ReactNode;
};

const TONES = {
  amber:
    "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  red: "border-red-200 bg-red-50/70 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
} as const;

// Compact notice: one header line + small domain chips. Collapses beyond
// `maxVisible` so many domains never push the store grid off-screen.
export function NoticeBanner({
  tone,
  icon,
  title,
  linkLabel,
  linkHref,
  rows,
  maxVisible = 3,
}: {
  tone: keyof typeof TONES;
  icon: React.ReactNode;
  title: string;
  linkLabel: string;
  linkHref: string;
  rows: NoticeRow[];
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, maxVisible);
  const hidden = rows.length - visible.length;

  return (
    <div className={cn("rounded-lg border px-3 py-2.5 text-sm", TONES[tone])}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2 font-medium">
          {icon}
          <span>
            {title} <span className="opacity-70">({rows.length})</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {visible.map((r) => (
            <Link
              key={r.key}
              href={r.href}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-current/10 bg-background px-2 py-1 text-xs text-foreground transition-colors hover:border-current/40"
            >
              <code className="truncate font-medium">{r.domain}</code>
              {r.badge}
            </Link>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium underline-offset-4 hover:underline"
            >
              +{hidden} lainnya
              <ChevronDown className="size-3" />
            </button>
          )}
        </div>
        <Link
          href={linkHref}
          className="text-xs font-medium underline underline-offset-4 opacity-80 hover:opacity-100"
        >
          {linkLabel}
        </Link>
      </div>
    </div>
  );
}

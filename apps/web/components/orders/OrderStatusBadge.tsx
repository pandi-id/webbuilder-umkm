import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { orderStatusMeta } from "./utils";

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = orderStatusMeta(status);
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={cn("gap-1 whitespace-nowrap", className)}>
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

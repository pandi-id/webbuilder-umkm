import { CheckCircle2, CircleDot, Clock, XCircle } from "lucide-react";
import type { Order, OrderStatus } from "@/lib/api";
import { fmtPrice } from "@/components/site-dashboard/utils";

export const ORDER_STATUS_META: Record<
  OrderStatus,
  {
    label: string;
    variant: "warning" | "secondary" | "success" | "destructive";
    icon: React.ElementType;
  }
> = {
  new: { label: "Baru", variant: "warning", icon: CircleDot },
  processing: { label: "Diproses", variant: "secondary", icon: Clock },
  done: { label: "Selesai", variant: "success", icon: CheckCircle2 },
  cancelled: { label: "Dibatalkan", variant: "destructive", icon: XCircle },
};

// Button copy for moving an order INTO the given status.
export const TRANSITION_LABEL: Record<OrderStatus, string> = {
  new: "Baru",
  processing: "Proses",
  done: "Selesai",
  cancelled: "Batalkan",
};

export function orderStatusMeta(status: string) {
  return ORDER_STATUS_META[status as OrderStatus] ?? ORDER_STATUS_META.new;
}

// "6281234567890" → "0812-3456-7890"; anything unexpected is returned as-is.
export function formatWa(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("62") ? `0${digits.slice(2)}` : digits;
  if (!local.startsWith("0") || local.length < 8) return raw ?? "";
  return [local.slice(0, 4), local.slice(4, 8), local.slice(8)].filter(Boolean).join("-");
}

export function waHref(phone: string, message?: string): string {
  const digits = phone.replace(/\D/g, "");
  const n = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${n}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

export function fmtOrderTotal(o: Pick<Order, "total" | "currency">): string {
  return fmtPrice(o.total, o.currency || "IDR");
}

// "Kopi Susu ×2, +1 lainnya"
export function itemsSummary(items: Order["items"]): string {
  const list = items ?? [];
  if (list.length === 0) return "(tanpa barang)";
  const first = `${list[0].name} ×${list[0].qty}`;
  return list.length > 1 ? `${first}, +${list.length - 1} lainnya` : first;
}

export function totalQty(items: Order["items"]): number {
  return (items ?? []).reduce((sum, it) => sum + (it.qty || 0), 0);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Prefilled chat text matches the order's state so the seller rarely edits it.
export function buyerMessage(o: Order): string {
  const name = o.customer_name?.trim() || "Kak";
  const total = fmtOrderTotal(o);
  switch (o.status) {
    case "done":
      return `Halo ${name}, pesanan ${o.order_no} (total ${total}) sudah selesai. Terima kasih sudah berbelanja di toko kami!`;
    case "cancelled":
      return `Halo ${name}, mohon maaf, pesanan ${o.order_no} terpaksa kami batalkan. Silakan hubungi kami bila ada pertanyaan.`;
    default:
      return `Halo ${name}, terima kasih sudah memesan. Pesanan ${o.order_no} (total ${total}) sedang kami proses. Kami kabari lagi ya.`;
  }
}

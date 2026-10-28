"use client";

import { useState } from "react";
import { Check, Copy, Loader2, MapPin, MessageCircle, Phone, StickyNote, User } from "lucide-react";
import { toast } from "sonner";
import { ORDER_TRANSITIONS, type Order, type OrderStatus } from "@/lib/api";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import {
  TRANSITION_LABEL,
  buyerMessage,
  fmtDateTime,
  fmtOrderTotal,
  formatWa,
  totalQty,
  waHref,
} from "@/components/orders/utils";
import { fmtPrice, timeAgo } from "@/components/site-dashboard/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

// Shared by the table row, mobile card and detail dialog so each surface offers
// exactly the transitions the API accepts.
export function StatusActions({
  order,
  busy,
  onRequest,
  size = "sm",
  className,
}: {
  order: Order;
  busy: boolean;
  onRequest: (order: Order, to: OrderStatus) => void;
  size?: "sm" | "default";
  className?: string;
}) {
  const next = ORDER_TRANSITIONS[order.status] ?? [];
  if (next.length === 0) return null;
  return (
    <div className={className ?? "flex flex-wrap items-center gap-1.5"}>
      {next.map((to) => (
        <Button
          key={to}
          size={size}
          disabled={busy}
          variant={to === "cancelled" ? "ghost" : to === "processing" ? "default" : "outline"}
          className={
            (size === "sm" ? "h-8 px-2.5 " : "") +
            (to === "cancelled" ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : "")
          }
          onClick={(e) => {
            e.stopPropagation();
            onRequest(order, to);
          }}
        >
          {busy && to !== "cancelled" ? <Loader2 className="animate-spin" /> : null}
          {TRANSITION_LABEL[to]}
        </Button>
      ))}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(`${label} disalin`);
    } catch {
      toast.error("Gagal menyalin");
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 text-muted-foreground"
      onClick={copy}
      aria-label={`Salin ${label.toLowerCase()}`}
      title={`Salin ${label.toLowerCase()}`}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
    </Button>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  copyLabel,
  children,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  copyLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="whitespace-pre-line break-words text-sm">{children ?? (value || "—")}</div>
      </div>
      {copyLabel && value ? <CopyButton value={value} label={copyLabel} /> : null}
    </div>
  );
}

export function OrderDetailDialog({
  order,
  open,
  onOpenChange,
  busy,
  onRequestStatus,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onRequestStatus: (order: Order, to: OrderStatus) => void;
}) {
  if (!order) return null;
  const items = order.items ?? [];
  const phone = formatWa(order.customer_phone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-5 sm:p-6">
        <DialogHeader className="space-y-2 pr-6 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-xl tabular-nums">Pesanan {order.order_no}</DialogTitle>
            <OrderStatusBadge status={order.status} />
          </div>
          <DialogDescription>
            Masuk {timeAgo(order.created_at)} · {fmtDateTime(order.created_at)}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Data pembeli</h3>
          <InfoRow icon={User} label="Nama" value={order.customer_name} copyLabel="Nama" />
          <InfoRow icon={Phone} label="WhatsApp" value={phone} copyLabel="Nomor">
            {phone ? (
              <a
                href={waHref(order.customer_phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium tabular-nums text-primary hover:underline"
              >
                {phone}
              </a>
            ) : (
              "—"
            )}
          </InfoRow>
          <InfoRow icon={MapPin} label="Alamat" value={order.customer_address} copyLabel="Alamat" />
          {order.note?.trim() ? (
            <InfoRow icon={StickyNote} label="Catatan pembeli" value={order.note} />
          ) : null}
        </section>

        <section className="rounded-lg border">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="text-sm font-semibold">Barang dipesan</h3>
            <span className="text-xs text-muted-foreground">{totalQty(order.items)} barang</span>
          </div>
          <Separator />
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Tidak ada barang di pesanan ini.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((it, i) => (
                <li key={`${it.product_id}-${i}`} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-medium">{it.name}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {it.qty} × {fmtPrice(it.price, order.currency || "IDR")}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-medium tabular-nums">
                    {fmtPrice(it.subtotal, order.currency || "IDR")}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Separator />
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold">Total</span>
            <span className="text-lg font-bold tabular-nums">{fmtOrderTotal(order)}</span>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <div>Dibuat</div>
            <div className="text-sm text-foreground">{fmtDateTime(order.created_at)}</div>
          </div>
          <div>
            <div>Terakhir diperbarui</div>
            <div className="text-sm text-foreground">{fmtDateTime(order.updated_at)}</div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:items-center sm:justify-between sm:space-x-0">
          {order.customer_phone ? (
            <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
              <a
                href={waHref(order.customer_phone, buyerMessage(order))}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle />
                Hubungi pembeli via WhatsApp
              </a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Pembeli tidak mencantumkan nomor.</span>
          )}
          <StatusActions
            order={order}
            busy={busy}
            onRequest={onRequestStatus}
            size="default"
            className="flex flex-wrap gap-2 sm:justify-end"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelOrderDialog({
  order,
  busy,
  onOpenChange,
  onConfirm,
}: {
  order: Order | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Batalkan pesanan {order?.order_no}?</DialogTitle>
          <DialogDescription>
            Stok produk di pesanan ini akan dikembalikan otomatis. Pesanan yang sudah dibatalkan
            tidak bisa diproses lagi.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Kembali
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Ya, batalkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Cart types + order API client for UMKM shops. Prices kept here are display-only;
// the order response from POST /public/sites/:id/orders is authoritative.
import { formatRupiah, waLink } from "@/lib/umkm";

export const CART_MAX_QTY = 99;
export const CART_MAX_ITEMS = 50;

export type CartItem = {
  slug: string;
  name: string;
  price: number;
  image: string;
  qty: number;
};

export type CheckoutCustomer = {
  name: string;
  phone: string;
  address: string;
};

export type OrderItem = {
  product_id: string;
  slug: string;
  name: string;
  price: number;
  qty: number;
  subtotal: number;
};

export type Order = {
  id: string;
  seq: number;
  order_no: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  note: string;
  items: OrderItem[];
  total: number;
  currency: string;
  created_at: string;
};

export type OrderResult = {
  order: Order;
  whatsapp_number: string;
  store_name: string;
};

export type CheckoutFields = CheckoutCustomer & { note: string };
export type CheckoutErrors = Partial<Record<keyof CheckoutFields, string>>;

export function cartStorageKey(siteId: string): string {
  return `wb-cart:v1:${siteId}`;
}

export function clampQty(n: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(CART_MAX_QTY, Math.max(1, v));
}

// sanitizeCart guards against hand-edited or stale localStorage payloads.
export function sanitizeCart(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CartItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const slug = typeof r.slug === "string" ? r.slug.trim() : "";
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const price = Number(r.price);
    out.push({
      slug,
      name: typeof r.name === "string" ? r.name : slug,
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      image: typeof r.image === "string" ? r.image : "",
      qty: clampQty(Number(r.qty)),
    });
    if (out.length >= CART_MAX_ITEMS) break;
  }
  return out;
}

// Mirrors the API's normalisation (leading 0 → 62) so the inline check agrees with the server.
export function phoneDigits(raw: string): string {
  let n = String(raw ?? "").replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  return n;
}

export function validateCheckout(f: CheckoutFields): CheckoutErrors {
  const e: CheckoutErrors = {};
  const name = f.name.trim();
  if (name.length < 2) e.name = "Nama minimal 2 karakter.";
  else if (name.length > 80) e.name = "Nama maksimal 80 karakter.";
  const digits = phoneDigits(f.phone);
  if (!digits) e.phone = "Nomor WhatsApp wajib diisi.";
  else if (digits.length < 9 || digits.length > 15) e.phone = "Nomor WhatsApp harus 9–15 digit, contoh 0812-3456-7890.";
  const address = f.address.trim();
  if (!address) e.address = "Alamat pengiriman wajib diisi.";
  else if (address.length > 300) e.address = "Alamat maksimal 300 karakter.";
  if (f.note.trim().length > 500) e.note = "Catatan maksimal 500 karakter.";
  return e;
}

export function formatMoney(amount: number, currency = "IDR"): string {
  if (!currency || currency === "IDR") return formatRupiah(amount);
  return `${currency} ${formatRupiah(amount).replace(/^-?Rp /, amount < 0 ? "-" : "")}`;
}

export function orderWhatsAppMessage(res: OrderResult): string {
  const o = res.order;
  const lines: string[] = [];
  lines.push(res.store_name ? `Halo ${res.store_name}, saya mau pesan:` : "Halo, saya mau pesan:");
  lines.push("");
  lines.push(`Pesanan ${o.order_no}`);
  for (const it of o.items) {
    lines.push(`• ${it.name} x${it.qty} = ${formatMoney(it.subtotal, o.currency)}`);
  }
  lines.push("");
  lines.push(`Total: ${formatMoney(o.total, o.currency)}`);
  lines.push("");
  lines.push(`Nama: ${o.customer_name}`);
  lines.push(`No. WhatsApp: ${o.customer_phone}`);
  if (o.customer_address) lines.push(`Alamat: ${o.customer_address}`);
  if (o.note) lines.push(`Catatan: ${o.note}`);
  return lines.join("\n");
}

export function orderWhatsAppHref(res: OrderResult): string {
  return res.whatsapp_number ? waLink(res.whatsapp_number, orderWhatsAppMessage(res)) : "";
}

export class OrderError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

export async function submitOrder(
  siteId: string,
  items: CartItem[],
  fields: CheckoutFields,
  honeypot: string,
): Promise<OrderResult> {
  if (!API) throw new OrderError(0, "no_api", "Konfigurasi API tidak tersedia.");
  let res: Response;
  try {
    res = await fetch(`${API}/public/sites/${encodeURIComponent(siteId)}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((it) => ({ slug: it.slug, qty: it.qty })),
        customer: {
          name: fields.name.trim(),
          phone: fields.phone.trim(),
          address: fields.address.trim(),
        },
        note: fields.note.trim(),
        _hp: honeypot,
      }),
    });
  } catch {
    throw new OrderError(0, "network", "Gagal terhubung ke server. Periksa koneksi lalu coba lagi.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = String(body?.error?.code ?? "");
    const fallback =
      res.status === 429
        ? "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."
        : `Pesanan gagal dibuat (kode ${res.status}). Coba lagi.`;
    throw new OrderError(res.status, code, String(body?.error?.message ?? fallback));
  }
  const data = body?.data as OrderResult | undefined;
  if (!data?.order) throw new OrderError(res.status, "bad_response", "Respons server tidak dikenali. Coba lagi.");
  return {
    order: { ...data.order, items: Array.isArray(data.order.items) ? data.order.items : [] },
    whatsapp_number: data.whatsapp_number ?? "",
    store_name: data.store_name ?? "",
  };
}

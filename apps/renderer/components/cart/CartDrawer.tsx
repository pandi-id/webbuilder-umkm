"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  CART_MAX_QTY,
  OrderError,
  formatMoney,
  orderWhatsAppHref,
  submitOrder,
  validateCheckout,
  type CheckoutErrors,
  type CheckoutFields,
  type OrderResult,
} from "@/lib/cart";
import { useCart } from "./CartProvider";
import { CartIcon } from "./icons";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD_ORDER: Array<keyof CheckoutFields> = ["name", "phone", "address", "note"];

export function CartFab() {
  const cart = useCart();
  if (!cart || !cart.ready || cart.count === 0) return null;
  return (
    <button
      type="button"
      className="wb-cart-fab"
      onClick={() => cart.setOpen(true)}
      aria-label={`Buka keranjang, ${cart.count} barang`}
      aria-haspopup="dialog"
    >
      <CartIcon name="cart" />
      <span className="wb-cart-fab-label">Keranjang</span>
      <span className="wb-cart-fab-count" aria-hidden="true">
        {cart.count > CART_MAX_QTY ? "99+" : cart.count}
      </span>
    </button>
  );
}

export function CartDrawer() {
  const cart = useCart();
  if (!cart || !cart.open) return null;
  return <CartDialog />;
}

function CartDialog() {
  const cart = useCart()!;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hpRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof CheckoutFields, boolean>>>({});
  const [result, setResult] = useState<OrderResult | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
  const close = () => cart.setOpen(false);

  // Focus in, scroll lock, focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    closeRef.current?.focus();
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // Document-level so ESC works even when focus drifted outside the panel.
  useEffect(() => {
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") cart.setOpen(false);
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [cart.setOpen]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const errors: CheckoutErrors = validateCheckout(cart.form);
  const visibleError = (k: keyof CheckoutFields) => (submitted || touched[k] ? errors[k] : undefined);
  const setField = (k: keyof CheckoutFields, v: string) => cart.setForm({ ...cart.form, [k]: v });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || cart.items.length === 0) return;
    setSubmitted(true);
    const firstBad = FIELD_ORDER.find((k) => errors[k]);
    if (firstBad) {
      document.getElementById(`wb-cart-f-${firstBad}`)?.focus();
      return;
    }
    setSending(true);
    setError("");
    const expected = cart.subtotal;
    try {
      const res = await submitOrder(cart.siteId, cart.items, cart.form, hpRef.current?.value ?? "");
      cart.clear();
      // Keep contact details for a repeat order; the note is per-order.
      cart.setForm({ ...cart.form, note: "" });
      setPriceChanged(res.order.total !== expected);
      setResult(res);
      cart.announce(`Pesanan ${res.order.order_no} berhasil dibuat.`);
      const href = orderWhatsAppHref(res);
      // window.open after an await is popup-blocked; same-tab navigation isn't.
      // Inside an iframe (dashboard preview) wa.me refuses framing, so leave it to the button.
      if (href && window.self === window.top) window.location.href = href;
    } catch (err) {
      setError(err instanceof OrderError ? err.message : "Pesanan gagal dibuat. Coba lagi.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="wb-cart-root">
      <div className="wb-cart-backdrop" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        className="wb-cart-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wb-cart-title"
        onKeyDown={onKeyDown}
      >
        <header className="wb-cart-head">
          <h2 id="wb-cart-title" className="wb-cart-title">
            {result ? "Pesanan dibuat" : "Keranjang"}
            {!result && cart.count > 0 ? <span className="wb-cart-title-count">{cart.count} barang</span> : null}
          </h2>
          <button ref={closeRef} type="button" className="wb-cart-icon-btn" onClick={close} aria-label="Tutup keranjang">
            <CartIcon name="x" />
          </button>
        </header>

        {result ? (
          <SuccessView result={result} priceChanged={priceChanged} onClose={close} />
        ) : cart.items.length === 0 ? (
          <div className="wb-cart-body wb-cart-empty">
            <span className="wb-cart-empty-ico">
              <CartIcon name="cart" />
            </span>
            <p className="wb-cart-empty-title">Keranjang masih kosong</p>
            <p className="wb-cart-muted">Pilih produk lalu tekan tombol Keranjang untuk mulai memesan.</p>
            <button type="button" className="wb-cart-btn wb-cart-btn--ghost" onClick={close}>
              Lanjut belanja
            </button>
          </div>
        ) : (
          <>
            <div className="wb-cart-body">
              <ul className="wb-cart-items" aria-label="Isi keranjang">
                {cart.items.map((it) => (
                  <li key={it.slug} className="wb-cart-item">
                    <div className="wb-cart-thumb">
                      {it.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <CartIcon name="image" />
                      )}
                    </div>
                    <div className="wb-cart-item-main">
                      <p className="wb-cart-item-name">{it.name}</p>
                      <p className="wb-cart-muted wb-cart-item-price">{formatMoney(it.price)}</p>
                      <div className="wb-cart-item-ctrl">
                        <div className="wb-cart-stepper" role="group" aria-label={`Jumlah ${it.name}`}>
                          <button
                            type="button"
                            onClick={() => cart.setQty(it.slug, it.qty - 1)}
                            disabled={it.qty <= 1}
                            aria-label={`Kurangi ${it.name}`}
                          >
                            <CartIcon name="minus" />
                          </button>
                          <span>{it.qty}</span>
                          <button
                            type="button"
                            onClick={() => cart.setQty(it.slug, it.qty + 1)}
                            disabled={it.qty >= CART_MAX_QTY}
                            aria-label={`Tambah ${it.name}`}
                          >
                            <CartIcon name="plus" />
                          </button>
                        </div>
                        <span className="wb-cart-item-total">{formatMoney(it.price * it.qty)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="wb-cart-icon-btn wb-cart-remove"
                      onClick={() => cart.remove(it.slug)}
                      aria-label={`Hapus ${it.name} dari keranjang`}
                    >
                      <CartIcon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>

              <form id="wb-cart-form" className="wb-cart-form" onSubmit={onSubmit} noValidate>
                <h3 className="wb-cart-subtitle">Data pemesan</h3>
                {/* Honeypot: off-screen rather than display:none, which many bots skip. */}
                <input
                  ref={hpRef}
                  type="text"
                  name="_hp"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="wb-cart-hp"
                />
                <Field
                  id="name"
                  label="Nama"
                  value={cart.form.name}
                  error={visibleError("name")}
                  onChange={(v) => setField("name", v)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  input={{ autoComplete: "name", maxLength: 80, placeholder: "Nama lengkap" }}
                />
                <Field
                  id="phone"
                  label="No. WhatsApp"
                  value={cart.form.phone}
                  error={visibleError("phone")}
                  onChange={(v) => setField("phone", v)}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  input={{ type: "tel", inputMode: "tel", autoComplete: "tel", maxLength: 20, placeholder: "0812-3456-7890" }}
                />
                <Field
                  id="address"
                  label="Alamat pengiriman"
                  value={cart.form.address}
                  error={visibleError("address")}
                  onChange={(v) => setField("address", v)}
                  onBlur={() => setTouched((t) => ({ ...t, address: true }))}
                  multiline
                  input={{ autoComplete: "street-address", maxLength: 300, placeholder: "Jalan, nomor rumah, kelurahan, kota" }}
                />
                <Field
                  id="note"
                  label="Catatan"
                  optional
                  value={cart.form.note}
                  error={visibleError("note")}
                  onChange={(v) => setField("note", v)}
                  onBlur={() => setTouched((t) => ({ ...t, note: true }))}
                  multiline
                  input={{ maxLength: 500, placeholder: "Contoh: tanpa gula, kirim sore hari" }}
                />
              </form>
            </div>

            <footer className="wb-cart-foot">
              {error ? (
                <p className="wb-cart-alert" role="alert">
                  <CartIcon name="alert" />
                  <span>{error}</span>
                </p>
              ) : null}
              <div className="wb-cart-sum">
                <span>Subtotal</span>
                <strong>{formatMoney(cart.subtotal)}</strong>
              </div>
              <p className="wb-cart-muted wb-cart-fine">Total final mengikuti harga terbaru toko saat pesanan dibuat.</p>
              <button
                type="submit"
                form="wb-cart-form"
                className="wb-cart-btn wb-cart-btn--primary wb-cart-btn--lg wb-cart-btn--block"
                disabled={sending}
                aria-busy={sending}
              >
                {sending ? <span className="wb-cart-spinner" aria-hidden="true" /> : null}
                <span>{sending ? "Membuat pesanan…" : "Pesan via WhatsApp"}</span>
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  error,
  onChange,
  onBlur,
  multiline,
  optional,
  input,
}: {
  id: keyof CheckoutFields;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  multiline?: boolean;
  optional?: boolean;
  input: {
    type?: string;
    inputMode?: "tel" | "text";
    autoComplete?: string;
    maxLength?: number;
    placeholder?: string;
  };
}) {
  const fid = `wb-cart-f-${id}`;
  const common = {
    id: fid,
    name: id,
    value,
    onBlur,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${fid}-err` : undefined,
    className: error ? "wb-cart-input is-invalid" : "wb-cart-input",
    autoComplete: input.autoComplete,
    maxLength: input.maxLength,
    placeholder: input.placeholder,
  };
  return (
    <div className="wb-cart-field">
      <label htmlFor={fid} className="wb-cart-label">
        {label}
        {optional ? <span className="wb-cart-muted"> (opsional)</span> : null}
      </label>
      {multiline ? (
        <textarea {...common} rows={id === "note" ? 2 : 3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={input.type ?? "text"} inputMode={input.inputMode} onChange={(e) => onChange(e.target.value)} />
      )}
      {error ? (
        <p id={`${fid}-err`} className="wb-cart-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SuccessView({ result, priceChanged, onClose }: { result: OrderResult; priceChanged: boolean; onClose: () => void }) {
  const o = result.order;
  const href = orderWhatsAppHref(result);
  return (
    <div className="wb-cart-body wb-cart-success">
      <span className="wb-cart-success-ico">
        <CartIcon name="check" />
      </span>
      <p className="wb-cart-success-title">Pesanan {o.order_no} berhasil dibuat</p>
      {href ? (
        <p className="wb-cart-muted">Membuka WhatsApp untuk mengirim pesanan ke toko. Kalau tidak terbuka otomatis, tekan tombol di bawah.</p>
      ) : (
        <p className="wb-cart-muted">Pesanan tercatat. Toko akan menghubungi Anda lewat WhatsApp.</p>
      )}

      <ul className="wb-cart-receipt" aria-label="Rincian pesanan">
        {o.items.map((it) => (
          <li key={it.slug || it.product_id}>
            <span>
              {it.name} <span className="wb-cart-muted">x{it.qty}</span>
            </span>
            <span>{formatMoney(it.subtotal, o.currency)}</span>
          </li>
        ))}
        <li className="wb-cart-receipt-total">
          <span>Total</span>
          <strong>{formatMoney(o.total, o.currency)}</strong>
        </li>
      </ul>
      {priceChanged ? <p className="wb-cart-muted wb-cart-fine">Total disesuaikan dengan harga terbaru toko.</p> : null}

      <div className="wb-cart-success-actions">
        {href ? (
          <a className="wb-cart-btn wb-cart-btn--primary wb-cart-btn--lg wb-cart-btn--block" href={href} target="_blank" rel="noopener noreferrer">
            Buka WhatsApp
          </a>
        ) : null}
        <button type="button" className="wb-cart-btn wb-cart-btn--ghost wb-cart-btn--block" onClick={onClose}>
          Lanjut belanja
        </button>
      </div>
    </div>
  );
}

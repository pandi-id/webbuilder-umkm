"use client";

import { useState } from "react";
import { CART_MAX_QTY, clampQty } from "@/lib/cart";
import { useCart } from "./CartProvider";
import { CartIcon } from "./icons";

type Props = {
  slug: string;
  name: string;
  price: number;
  image: string;
  stock: number | null;
};

// Qty stepper + add/buy-now for the product detail page.
export function ProductPurchase({ slug, name, price, image, stock }: Props) {
  const cart = useCart();
  const max = stock != null ? Math.max(0, Math.min(CART_MAX_QTY, stock)) : CART_MAX_QTY;
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  if (!cart) return null;

  if (max <= 0) {
    return (
      <div className="wb-cart-purchase">
        <button type="button" className="wb-cart-btn wb-cart-btn--block" disabled>
          Stok habis
        </button>
      </div>
    );
  }

  const set = (n: number) => setQty(Math.min(max, clampQty(n)));

  function addToCart(openAfter: boolean) {
    if (!cart || !cart.add({ slug, name, price, image }, qty)) return;
    if (openAfter) {
      cart.setOpen(true);
      return;
    }
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <div className="wb-cart-purchase">
      <div className="wb-cart-purchase-row">
        <span className="wb-cart-purchase-label" id="wb-cart-qty-label">
          Jumlah
        </span>
        <div className="wb-cart-stepper wb-cart-stepper--lg" role="group" aria-labelledby="wb-cart-qty-label">
          <button type="button" onClick={() => set(qty - 1)} disabled={qty <= 1} aria-label="Kurangi jumlah">
            <CartIcon name="minus" />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={qty}
            onChange={(e) => set(Number(e.target.value) || 1)}
            aria-label="Jumlah"
          />
          <button type="button" onClick={() => set(qty + 1)} disabled={qty >= max} aria-label="Tambah jumlah">
            <CartIcon name="plus" />
          </button>
        </div>
      </div>
      <div className="wb-cart-purchase-actions">
        <button type="button" className="wb-cart-btn wb-cart-btn--ghost wb-cart-btn--lg" onClick={() => addToCart(false)}>
          <CartIcon name={added ? "check" : "cart"} />
          <span>{added ? "Ditambahkan" : "Tambah ke Keranjang"}</span>
        </button>
        <button type="button" className="wb-cart-btn wb-cart-btn--primary wb-cart-btn--lg" onClick={() => addToCart(true)}>
          Beli Sekarang
        </button>
      </div>
    </div>
  );
}

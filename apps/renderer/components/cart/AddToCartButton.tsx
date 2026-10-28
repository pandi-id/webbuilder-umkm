"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "./CartProvider";
import { CartIcon } from "./icons";

type Props = {
  slug: string;
  name: string;
  price: number;
  image: string;
  className?: string;
  label?: string;
};

// Renders nothing outside a CartProvider (template previews), so it can be
// dropped into shared server-rendered cards unconditionally.
export function AddToCartButton({ slug, name, price, image, className, label = "Keranjang" }: Props) {
  const cart = useCart();
  const [added, setAdded] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  if (!cart) return null;

  function onClick() {
    if (!cart || !cart.add({ slug, name, price, image }, 1)) return;
    setAdded(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <button
      type="button"
      className={`wb-cart-add ${className ?? "wb-cart-btn wb-cart-btn--primary wb-cart-btn--block"}`}
      onClick={onClick}
      aria-label={`Tambah ${name} ke keranjang`}
    >
      <CartIcon name={added ? "check" : "cart"} />
      <span>{added ? "Ditambahkan" : label}</span>
    </button>
  );
}

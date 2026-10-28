"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CART_MAX_ITEMS,
  CART_MAX_QTY,
  cartStorageKey,
  clampQty,
  sanitizeCart,
  type CartItem,
  type CheckoutFields,
} from "@/lib/cart";

type AddInput = Omit<CartItem, "qty">;

export type CartApi = {
  siteId: string;
  // false until localStorage has been read — anything count-dependent waits for it
  // so the server HTML and the first client render match.
  ready: boolean;
  items: CartItem[];
  count: number;
  subtotal: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  add: (item: AddInput, qty?: number) => boolean;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  // Kept in memory so closing the drawer doesn't wipe what the buyer typed.
  form: CheckoutFields;
  setForm: (f: CheckoutFields) => void;
  announce: (msg: string) => void;
};

const CartContext = createContext<CartApi | null>(null);

// Null outside a provider (template previews) — callers render nothing then.
export function useCart(): CartApi | null {
  return useContext(CartContext);
}

function readStored(key: string): CartItem[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? sanitizeCart(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ siteId, children }: { siteId: string; children: ReactNode }) {
  const key = cartStorageKey(siteId);
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CheckoutFields>({ name: "", phone: "", address: "", note: "" });
  const [message, setMessage] = useState("");
  // Skips the write that would otherwise echo a value we just read from storage.
  const skipWrite = useRef(true);

  useEffect(() => {
    setItems(readStored(key));
    setReady(true);
    // Another tab changed the cart: follow it instead of overwriting it later.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      skipWrite.current = true;
      setItems(readStored(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    try {
      if (items.length === 0) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // Storage blocked (private mode, sandboxed iframe) — cart still works for this page view.
    }
  }, [items, key, ready]);

  const announce = useCallback((msg: string) => {
    // Re-set via empty string so repeating the same text is announced again.
    setMessage("");
    window.setTimeout(() => setMessage(msg), 30);
  }, []);

  // Ref mirrors state so add() can report "cart full" synchronously, even on rapid clicks.
  const itemsRef = useRef<CartItem[]>([]);
  itemsRef.current = items;

  const add = useCallback(
    (item: AddInput, qty = 1) => {
      const prev = itemsRef.current;
      const i = prev.findIndex((p) => p.slug === item.slug);
      let next: CartItem[];
      if (i >= 0) {
        next = prev.slice();
        next[i] = { ...prev[i], ...item, qty: Math.min(CART_MAX_QTY, prev[i].qty + clampQty(qty)) };
      } else if (prev.length >= CART_MAX_ITEMS) {
        announce(`Keranjang penuh — maksimal ${CART_MAX_ITEMS} jenis produk per pesanan.`);
        return false;
      } else {
        next = [...prev, { ...item, qty: clampQty(qty) }];
      }
      itemsRef.current = next;
      setItems(next);
      announce(`${item.name} ditambahkan ke keranjang.`);
      return true;
    },
    [announce],
  );

  const setQty = useCallback((slug: string, qty: number) => {
    setItems((prev) => prev.map((p) => (p.slug === slug ? { ...p, qty: clampQty(qty) } : p)));
  }, []);

  const remove = useCallback((slug: string) => {
    setItems((prev) => prev.filter((p) => p.slug !== slug));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const api = useMemo<CartApi>(() => {
    const count = items.reduce((n, it) => n + it.qty, 0);
    const subtotal = items.reduce((n, it) => n + it.price * it.qty, 0);
    return { siteId, ready, items, count, subtotal, open, setOpen, add, setQty, remove, clear, form, setForm, announce };
  }, [siteId, ready, items, open, add, setQty, remove, clear, form, announce]);

  return (
    <CartContext.Provider value={api}>
      {children}
      <div className="wb-cart-sr" role="status" aria-live="polite">
        {message}
      </div>
    </CartContext.Provider>
  );
}

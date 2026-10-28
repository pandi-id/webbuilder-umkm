// SiteCart wraps a tenant page so add-to-cart buttons, the floating cart and the
// checkout drawer share one cart. Template previews skip it on purpose: without a
// provider every cart control renders nothing.
import type { ReactNode } from "react";
import { CartDrawer, CartFab } from "./CartDrawer";
import { CartProvider } from "./CartProvider";
import "./cart.css";

export function SiteCart({ siteId, children }: { siteId: string; children: ReactNode }) {
  if (!siteId || siteId.startsWith("_template")) return <>{children}</>;
  return (
    <CartProvider siteId={siteId}>
      {children}
      <CartFab />
      <CartDrawer />
    </CartProvider>
  );
}

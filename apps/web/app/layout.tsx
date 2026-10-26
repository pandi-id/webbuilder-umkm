//@ts-ignore
import "./globals.css";
import type { Metadata } from "next";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Website & Toko Online UMKM — Buat tanpa coding",
  description:
    "Buat website dan toko online untuk UMKM dengan editor visual. Katalog produk, domain .id sendiri, SSL otomatis, dan siap dipakai jualan.",
};

// Force dynamic rendering app-wide — dashboard is per-user auth, zero SSG
// benefit. Required so middleware CSP nonce gets injected into Next.js
// inline bootstrap/RSC/hydration scripts (SSG bakes HTML at build-time
// without per-request nonce → CSP blocks everything).
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}

"use client";

// OAuth callback landing — the API redirects here after a successful Google
// or e.id login with tokens in the URL fragment:
//
//   /auth/callback#access_token=xxx&refresh_token=yyy&next=/dashboard
//
// Fragment (not query) is intentional so tokens never touch server logs on any
// intermediate hop. Runs client-side only; SSR would strip the fragment.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setTokens } from "@/lib/api";
import { Loader2, AlertCircle } from "lucide-react";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(raw);
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");
    const next = params.get("next") || "/dashboard";

    if (!access || !refresh) {
      setErr("Token tidak ditemukan di URL. Silakan coba login lagi.");
      return;
    }

    setTokens(access, refresh);
    // Wipe the fragment so tokens don't sit in browser history / back-button.
    window.history.replaceState({}, "", "/auth/callback");
    router.replace(next);
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        {err ? (
          <>
            <AlertCircle className="mx-auto size-8 text-destructive" />
            <p className="mt-3 text-sm text-destructive">{err}</p>
            <a
              href="/login"
              className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
            >
              Kembali ke halaman login
            </a>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Menyiapkan sesi Anda…</p>
          </>
        )}
      </div>
    </main>
  );
}

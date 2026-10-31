"use client";

// Public invitation accept page — /invite/[token].
// Flow:
//   1. GET /api/v1/invitations/:token → meta (email + role + inviter)
//   2. Show welcome + form (nama + password + confirm)
//   3. POST /api/v1/invitations/:token/accept → JWT
//   4. setTokens + redirect ke portal sesuai role

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe2,
  Loader2,
  Lock,
  UserPlus,
} from "lucide-react";
import { api, setTokens, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InviteMeta = {
  email: string;
  invited_role: "agent" | "client";
  inviter_name: string;
  expires_at: string;
  // True when the invite points at an account that can already log in: an
  // existing user being promoted. They keep their password, so the form turns
  // into a plain confirmation instead of a signup.
  existing_user?: boolean;
  needs_password?: boolean;
  invited_name?: string;
};

// `params` is a Promise in Next 16, so reading it as a prop yields undefined
// and every invitation looks invalid. useParams() is the client-side reader,
// and it is what the rest of the dashboard already uses.
export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [meta, setMeta] = useState<InviteMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [metaErr, setMetaErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<InviteMeta>(`/api/v1/invitations/${params.token}`, { auth: false })
      .then((m) => {
        setMeta(m);
        // Nothing to prefill for name — inviter tidak isi nama untuk agent invite.
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setMetaErr((e as Error).message);
        }
      })
      .finally(() => setLoadingMeta(false));
  }, [params.token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // An existing account supplies its own name and password; we send neither.
    const needsPassword = meta?.needs_password !== false;
    if (needsPassword) {
      if (!name.trim()) {
        setErr("Nama wajib diisi");
        return;
      }
      if (password.length < 8) {
        setErr("Password minimal 8 karakter");
        return;
      }
      if (password !== confirm) {
        setErr("Konfirmasi password tidak cocok");
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api<{ access_token: string; refresh_token: string }>(
        `/api/v1/invitations/${params.token}/accept`,
        {
          method: "POST",
          auth: false,
          body: needsPassword
            ? JSON.stringify({ name: name.trim(), password })
            : JSON.stringify({ name: "", password: "" }),
        },
      );
      setTokens(res.access_token, res.refresh_token);
      // A brand-new agent has nothing in the client dashboard yet, so drop
      // them straight into their portal. A promoted user already owns sites —
      // send them home, where the portal button sits in the header.
      if (meta?.invited_role === "agent" && !meta.existing_user) {
        router.replace("/agent/dashboard");
      } else {
        router.replace("/dashboard");
      }
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  if (loadingMeta) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Memverifikasi undangan…</p>
        </div>
      </Shell>
    );
  }

  if (notFound) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="size-6" />
          </div>
          <h2 className="text-lg font-semibold">Undangan tidak berlaku</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Undangan sudah kadaluarsa, sudah pernah dipakai, atau linknya tidak
            valid. Minta pengundang untuk kirim ulang undangan.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link href="/login">Kembali ke login</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (metaErr || !meta) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="size-6 text-destructive" />
          <p className="text-sm text-destructive">{metaErr || "Gagal memuat undangan"}</p>
        </div>
      </Shell>
    );
  }

  const roleLabel = meta.invited_role === "agent" ? "Agent" : "Klien";
  const expiresLabel = formatExpiry(meta.expires_at);
  const needsPassword = meta.needs_password !== false;

  return (
    <Shell>
      <div className="mb-6 flex items-start gap-3 rounded-lg bg-primary/5 p-4">
        <CheckCircle2 className="size-5 shrink-0 text-primary" />
        <div className="text-sm">
          <p>
            <span className="font-semibold">{meta.inviter_name}</span> mengundang
            Anda sebagai{" "}
            <span className="font-semibold">{roleLabel}</span>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Email: <span className="font-mono">{meta.email}</span> · Berlaku
            sampai {expiresLabel}
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {!needsPassword && (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="font-medium">
              Anda sudah punya akun{meta.invited_name ? ` sebagai ${meta.invited_name}` : ""}.
            </p>
            <p className="mt-1 text-muted-foreground">
              Password Anda tidak berubah. Setelah menerima undangan ini, akun Anda menjadi{" "}
              {roleLabel.toLowerCase()} dari {meta.inviter_name} — semua situs dan domain yang
              sudah Anda miliki tetap bisa dikelola seperti biasa.
            </p>
          </div>
        )}

        {needsPassword && (
          <>
        <div className="space-y-1.5">
          <Label htmlFor="name">Nama lengkap</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama Anda"
            required
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pw">Password baru</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pw"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              placeholder="Minimal 8 karakter"
              required
              className="pl-9 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              tabIndex={-1}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pw-confirm">Konfirmasi password</Label>
          <Input
            id="pw-confirm"
            type={showPw ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            placeholder="Ulangi password"
            required
          />
        </div>
          </>
        )}

        {err && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <Button type="submit" className="w-full gap-2" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {needsPassword ? "Mengaktifkan akun…" : "Memproses…"}
            </>
          ) : (
            <>
              <UserPlus className="size-4" />
              {needsPassword ? "Aktifkan Akun" : "Terima Undangan"}
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full bg-primary/5 blur-3xl" />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
            <Globe2 className="size-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Web<span className="text-primary">Builder</span>
          </h1>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-xl shadow-black/5">
          {children}
        </div>
      </div>
    </main>
  );
}

function formatExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

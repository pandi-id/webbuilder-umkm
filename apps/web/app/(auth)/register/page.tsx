"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { User, Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, ArrowRight, Globe2, CheckCircle2 } from "lucide-react";
import { api, setTokens } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/GoogleButton";

// EMAIL_RE — mirror auth.ValidEmail di backend (RFC 5322 subset praktis).
// Konsisten supaya browser tidak terima "foo@a" tapi backend tolak dengan
// pesan cryptic. Blokir di client lebih dulu untuk UX cepat.
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function validateEmail(s: string): string | null {
  const v = s.trim();
  if (!v) return null; // kosong → native required handle, jangan tampilkan pre-blur
  if (v.length > 254) return "Email terlalu panjang";
  if (!EMAIL_RE.test(v)) return "Format email tidak valid (contoh: nama@email.com)";
  return null;
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pwStrength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : 3;
  const pwColors = ["", "bg-red-500", "bg-amber-500", "bg-emerald-500"];
  const pwLabels = ["", "Terlalu pendek", "Cukup", "Kuat"];

  const emailError = emailTouched ? validateEmail(email) : null;
  const canSubmit =
    !loading &&
    name.trim().length > 0 &&
    EMAIL_RE.test(email.trim()) &&
    password.length >= 8;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Gate client-side sebelum network call — kalau user bypass tombol disabled
    // via DevTools / Enter, tetap tangkap di sini.
    setEmailTouched(true);
    const emailProblem = validateEmail(email);
    if (emailProblem) {
      setErr(emailProblem);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const data = await api<{ access_token: string; refresh_token: string }>(
        "/api/v1/auth/register",
        { method: "POST", body: JSON.stringify({ name, email: email.trim(), password }), auth: false },
      );
      setTokens(data.access_token, data.refresh_token);
      router.push("/dashboard");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
            <Globe2 className="size-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Web<span className="text-primary">Builder</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Buat akun gratis, lalu buka toko online di domain .id Anda
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border bg-card shadow-xl shadow-black/5 p-7">
          <GoogleButton label="Daftar dengan Google" />

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">atau daftar pakai email</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm font-medium">
                Nama
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama lengkap"
                  className="pl-9 h-10"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  autoComplete="email"
                  placeholder="nama@email.com"
                  className="pl-9 h-10"
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? "email-error" : undefined}
                />
              </div>
              {emailError && (
                <p id="email-error" className="text-xs text-destructive">
                  {emailError}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Min. 8 karakter"
                  className="pl-9 pr-10 h-10"
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

              {/* Password strength */}
              {password.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    {[1, 2, 3].map((level) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          pwStrength >= level ? pwColors[pwStrength] : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${pwStrength === 1 ? "text-red-500" : pwStrength === 2 ? "text-amber-500" : "text-emerald-600"}`}>
                    {pwLabels[pwStrength]}
                  </p>
                </div>
              )}
            </div>

            {/* Error */}
            {err && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{err}</span>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="mt-1 w-full h-10 gap-2 font-medium shadow-sm"
              disabled={!canSubmit}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Memproses…
                </>
              ) : (
                <>
                  Buat Akun
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          {/* Benefits */}
          <div className="mt-5 space-y-1.5">
            {["Daftar akun gratis — bayar hanya untuk domain toko", "Pesanan langsung masuk lewat WhatsApp", "Toko siap tayang dalam 5 menit"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                {item}
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Sudah punya akun?{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors"
            >
              Masuk
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

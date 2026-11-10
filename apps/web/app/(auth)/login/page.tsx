"use client";

// Halaman Login — split-panel: kiri brand storytelling (dark navy), kanan form.
// Mobile: brand panel di-hide, form full width.
// Login generic untuk semua role; brand copy diarahkan ke pemilik UMKM.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Globe,
  LayoutTemplate,
  Loader2,
  Lock,
  Mail,
  Package,
  Store,
} from "lucide-react";
import { api, clearTokens, getAccessToken, setTokens } from "@/lib/api";
import { defaultRouteForRole } from "@/lib/roles";
import { GoogleButton } from "@/components/GoogleButton";
import { EidButton } from "@/components/EidButton";

const OAUTH_ERROR_COPY: Record<string, string> = {
  state_mismatch: "Sesi login Google kedaluwarsa. Silakan coba lagi.",
  google_access_denied: "Anda membatalkan proses login di halaman Google.",
  exchange_failed: "Gagal memverifikasi login Google. Coba beberapa saat lagi.",
  profile_failed: "Gagal membaca profil Google. Coba lagi.",
  profile_incomplete:
    "Profil Google tidak lengkap. Pastikan akun Google Anda punya email publik.",
  email_unverified: "Alamat email Google Anda belum diverifikasi.",
  user_upsert_failed: "Terjadi kesalahan saat menyimpan akun Anda.",
  token_failed: "Terjadi kesalahan saat membuat sesi login.",
  // Returned by the API session gate when Google sign-in reaches a locked account.
  account_suspended: "Akun Anda dinonaktifkan oleh admin. Hubungi admin platform kalau menurut Anda ini keliru.",
  role_locked: "Akun reseller Anda belum aktif atau sedang ditangguhkan. Hubungi admin platform.",
  google_not_configured: "Login Google belum diaktifkan di server.",
  // e.id SSO (auth/eid.go).
  eid_not_configured: "Login e.id belum diaktifkan di server.",
  eid_state_mismatch: "Sesi login e.id kedaluwarsa. Silakan coba lagi.",
  eid_cancelled: "Anda membatalkan proses login di halaman e.id.",
  eid_code_expired: "Kode login e.id sudah kedaluwarsa. Silakan coba lagi.",
  eid_exchange_failed: "Gagal memverifikasi login e.id. Coba beberapa saat lagi.",
  eid_profile_failed: "Gagal membaca profil e.id. Coba lagi.",
  eid_no_email:
    "Akun e.id Anda tidak membagikan alamat email. Pastikan akun e.id punya email, lalu coba lagi.",
  eid_email_unverified:
    "Email akun e.id Anda belum terverifikasi, sementara email ini sudah dipakai untuk login di sini. Verifikasi email di aplikasi e.id dulu, atau masuk dengan password.",
  eid_user_failed: "Terjadi kesalahan saat menyimpan akun Anda.",
  eid_failed: "Terjadi kesalahan saat membuat sesi login.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath, setNextPath] = useState<string | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errCode = params.get("error");
    if (errCode) {
      const provider = errCode.startsWith("eid_") ? "e.id" : "Google";
      setErr(OAUTH_ERROR_COPY[errCode] ?? `Login ${provider} gagal (${errCode}).`);
    }
    const next = params.get("next");
    if (next) setNextPath(next);
    if (errCode) return;
    if (!getAccessToken()) return;
    api<{ role: string }>("/api/v1/auth/me")
      .then((me) => {
        const target = next || defaultRouteForRole(me.role);
        router.replace(target);
      })
      .catch(() => {
        clearTokens();
      });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const data = await api<{ access_token: string; refresh_token: string }>(
        "/api/v1/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }), auth: false },
      );
      setTokens(data.access_token, data.refresh_token);
      if (nextPath) {
        router.push(nextPath);
        return;
      }
      try {
        const me = await api<{ role: string }>("/api/v1/auth/me");
        router.push(defaultRouteForRole(me.role));
      } catch {
        router.push("/dashboard");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {/* Brand panel — hidden di mobile, full di lg+ */}
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#142741] to-[#0b1829] text-white lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-14 xl:px-20">
        {/* Ornament rings */}
        <div className="pointer-events-none absolute -bottom-40 -right-44 h-[420px] w-[420px] rounded-full border border-white/10 shadow-[0_0_0_70px_rgba(255,255,255,0.025),0_0_0_140px_rgba(255,255,255,0.018)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(233,133,85,0.22),transparent_35%)]" />

        <div className="relative z-10 max-w-[560px]">
          <Link href="/" className="mb-16 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[#ffbc85] to-[#e98555] shadow-lg shadow-orange-500/25">
              <Store className="size-6 text-white" />
            </div>
            <div>
              <div className="text-[16px] font-bold text-white">Dashboard Toko</div>
              <div className="text-[12px] text-slate-400">Website & toko online UMKM</div>
            </div>
          </Link>

          <span className="inline-block text-[11px] font-black uppercase tracking-[0.12em] text-orange-300">
            Ruang kerja digital untuk UMKM
          </span>
          <h1 className="mt-4 max-w-xl text-[clamp(2.15rem,3.4vw,3.4rem)] font-bold leading-[1.05] tracking-tight">
            Kelola produk, artikel, pesanan, dan website toko Anda dari satu tempat.
          </h1>
          <p className="mt-5 max-w-[560px] text-[15px] leading-relaxed text-slate-300">
            Masuk untuk melanjutkan pengelolaan website toko Anda dengan tampilan yang
            sederhana dan terarah.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FeatureCard
              icon={Package}
              title="Kelola Produk"
              subtitle="Katalog produk, artikel, dan formulir."
            />
            <FeatureCard
              icon={LayoutTemplate}
              title="Atur Tampilan"
              subtitle="Pilih template toko dan warna aksen."
            />
            <FeatureCard
              icon={Globe}
              title="Domain Sendiri"
              subtitle="Alamat .id milik toko, SSL otomatis."
            />
          </div>
        </div>

        <div className="relative z-10 text-[11px] tracking-wider text-slate-500">
          Website & Toko Online UMKM
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center bg-gradient-to-b from-[#f7f9fc] to-[#eef3f8] px-4 py-10 sm:px-6">
        <div className="w-full max-w-[470px]">
          {/* Mobile brand — hanya tampil di layar sempit karena panel kiri di-hide */}
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#ffbc85] to-[#e98555] shadow-lg shadow-orange-500/20">
              <Store className="size-5 text-white" />
            </div>
            <div>
              <div className="text-[15px] font-bold text-slate-900">Dashboard Toko</div>
              <div className="text-[11px] text-slate-500">Website & toko online UMKM</div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-2xl shadow-slate-900/10 sm:p-8">
            <div className="mb-6">
              <span className="inline-block text-[11px] font-black uppercase tracking-[0.12em] text-orange-500">
                Selamat datang kembali
              </span>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
                Masuk ke Dashboard Toko
              </h2>
              <p className="mt-1.5 text-sm text-slate-500">
                Gunakan akun Anda untuk melanjutkan.
              </p>
            </div>

            <GoogleButton next={nextPath} />
            <EidButton next={nextPath} className="mt-2.5" />

            <div className="my-5 flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              atau login pakai email
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Email" htmlFor="email">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="nama@tokoanda.id"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10"
                  />
                </div>
              </Field>

              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Masukkan password"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-11 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                    aria-label={showPw ? "Sembunyikan password" : "Tampilkan password"}
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <label className="inline-flex cursor-pointer items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="size-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/40"
                  />
                  <span>Ingat Saya</span>
                </label>
                <Link
                  href="/forgot-password"
                  className="font-bold text-blue-700 hover:text-blue-800"
                >
                  Lupa Password?
                </Link>
              </div>

              {err && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{err}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Memproses…
                  </>
                ) : (
                  <>
                    Masuk
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              Belum punya akun?{" "}
              <Link
                href="/register"
                className="font-bold text-slate-900 underline underline-offset-4 hover:text-slate-700"
              >
                Daftar gratis
              </Link>
            </p>
            <p className="mt-1.5 text-center text-xs text-slate-500">
              Agency atau reseller?{" "}
              <Link
                href="/daftar-reseller"
                className="font-bold text-orange-600 underline underline-offset-4 hover:text-orange-700"
              >
                Daftar sebagai reseller
              </Link>
            </p>
          </div>

          <p className="mt-5 text-center text-[11px] text-slate-500">
            Butuh bantuan? Hubungi administrator platform.
          </p>
        </div>
      </section>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur-sm">
      <Icon className="size-5 text-orange-300" />
      <div className="mt-2 text-[13px] font-bold text-white">{title}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-slate-400">{subtitle}</div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

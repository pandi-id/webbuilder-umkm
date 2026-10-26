"use client";

// Halaman polling status pembelian domain.
//
// Flow:
//   1. Halaman mount → GET /domains/purchases/:job_id (memicu refresh dari registrar)
//   2. Loop polling tiap 5s sampai status jadi terminal (active / failed / expired)
//      → interval turun ke 2s selama pending_payment supaya payment_url cepat
//        muncul begitu registrar-api generate.
//   3. Kalau status=active → tampilkan inline template picker → user pilih →
//      POST /sites/from-template/:slug lalu POST /domains/purchases/:job_id/attach
//      → navigate ke editor situs.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  ArrowRight,
  ChevronLeft,
  AlertCircle,
  Sparkles,
  FileText,
  Send,
  RotateCcw,
  Building2,
  Copy,
  Check,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { api, getAccessToken, clearTokens, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TemplatePreviewModal } from "@/components/templates/TemplatePreviewModal";

type Purchase = {
  job_id: string;
  domain: string;
  status: string;
  kind: string; // "register" | "renew" — pending page adapt UI berdasarkan ini
  payment_url?: string;
  // payment_method — code payment method (mis. "midtrans", "manual_bank").
  // Dipakai untuk pilih UI antara redirect gateway vs instruksi transfer manual.
  payment_method?: string;
  years?: number;
  reason?: string; // diisi kalau status=failed (dari registrar)
  expires_at?: string;
  updated_at?: string; // RFC3339 — buat detect "stuck"
  site_id?: string; // set kalau domain sudah di-attach ke sites row
};

type PaymentMethodInfo = {
  code: string;
  label: string;
  type: string;
  config?: {
    banks?: Array<{ name: string; account_number: string; account_holder: string }>;
    instructions_md?: string;
  };
};

type InvoiceInfo = {
  id: string;
  number: string;
  total: number;
  currency: string;
  due_at: string;
};

// Threshold "stuck" — pending_provisioning yang > STUCK_MS berarti EPP
// execute silent-drop (api-registry crash / timeout tidak keburu propagate).
// User boleh manual retry setelahnya.
const STUCK_MS = 60_000;

type Template = {
  slug: string;
  category: string;
  variant: string;
  name: string;
  description: string;
};

// statusInfo — copy per status + kind. Register vs renew punya semantik beda:
// register bikin domain BARU, renew hanya extend expiry — domain tetap
// aktif selama proses renew. Copy harus reflect itu supaya user tidak panik
// lihat "sedang diproses" mengira domain-nya offline.
type StatusInfo = { label: string; hint: string; kind: "wait" | "ok" | "bad" };

function statusInfo(status: string, purchaseKind: string): StatusInfo {
  const isRenew = purchaseKind === "renew";
  switch (status) {
    case "pending_payment":
      return {
        label: "Menunggu pembayaran",
        hint: "Klik tombol di bawah untuk bayar via gateway. Halaman ini akan refresh otomatis.",
        kind: "wait",
      };
    case "pending_document":
      return {
        label: "Menunggu dokumen",
        hint: "Registrar meminta upload KTP/NPWP. Silakan upload di form bawah.",
        kind: "wait",
      };
    case "pending_provisioning":
      return isRenew
        ? {
            label: "Perpanjangan sedang diproses",
            hint: "Pembayaran diterima. Registrar sedang extend expiry di registry (biasanya 1–5 menit). Domain Anda TETAP AKTIF selama proses.",
            kind: "wait",
          }
        : {
            label: "Sedang diproses registrar",
            hint: "Pembayaran diterima. Domain sedang di-daftarkan ke registry (biasanya 1–5 menit).",
            kind: "wait",
          };
    case "active":
      return isRenew
        ? {
            label: "Perpanjangan berhasil",
            hint: "Tanggal expire domain sudah diperbarui.",
            kind: "ok",
          }
        : {
            label: "Domain aktif",
            hint: "Domain Anda sudah live. Pilih template di bawah untuk buat situs.",
            kind: "ok",
          };
    case "failed":
      return {
        label: "Gagal",
        hint: isRenew
          ? "Perpanjangan gagal. Cek detail di bawah — domain Anda tidak terpengaruh."
          : "Pendaftaran domain gagal. Cek pesan detail di bawah.",
        kind: "bad",
      };
    case "expired":
      return {
        label: "Kadaluwarsa",
        hint: "Batas waktu pembayaran habis. Silakan coba lagi.",
        kind: "bad",
      };
    case "cancelled":
      return {
        label: "Dibatalkan",
        hint: isRenew
          ? "Perpanjangan dibatalkan. Domain Anda tidak terpengaruh."
          : "Pendaftaran dibatalkan sebelum pembayaran. Silakan mulai pembelian baru.",
        kind: "bad",
      };
    default:
      return { label: status, hint: "", kind: "wait" };
  }
}

function isTerminal(status: string) {
  return (
    status === "active" ||
    status === "failed" ||
    status === "expired" ||
    status === "cancelled"
  );
}

// friendlyRetryConflict — pattern-match error 409 dari POST /purchases/:id/retry
// supaya user tidak lihat pesan teknis registrar. Ada 2 kasus umum:
//   1. Job tidak punya invoice_id/domain_row_id → gagal sebelum payment init,
//      tidak recoverable. User harus register ulang.
//   2. Status bukan `failed` (mis. sudah active atau masih pending) → retry
//      tidak masuk akal untuk state itu.
function friendlyRetryConflict(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("invoice_id atau domain_row_id") ||
    lower.includes("mungkin gagal sebelum payment")
  ) {
    return "Job ini tidak bisa di-coba lagi karena gagal sebelum pembayaran ter-inisialisasi. Klik 'Mulai pembelian baru' untuk mengulang dari awal.";
  }
  if (lower.includes("hanya job dengan status=failed")) {
    return "Job ini bukan dalam status 'failed' — retry tidak berlaku. Refresh halaman untuk lihat status terbaru.";
  }
  return raw;
}

export default function PendingDomainPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [ready, setReady] = useState(false);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false); // job dihapus / expired dari registrar
  const [retrying, setRetrying] = useState(false);
  // Kalau retry balik 409 "invoice_id atau domain_row_id" (gagal sebelum
  // payment init), job tidak bisa direcover. Hide tombol Coba lagi + emphasize
  // Mulai baru supaya user tidak stuck klik retry berulang.
  const [retryUnrecoverable, setRetryUnrecoverable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Auth guard.
  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    api("/api/v1/auth/me")
      .then(() => setReady(true))
      .catch(() => {
        clearTokens();
        router.replace("/login");
      });
  }, [router]);

  // Adaptive polling: pending_payment butuh feedback cepat supaya payment_url
  // segera muncul → 2s. Provisioning EPP CREATE bisa lambat (network +
  // registry) → 5s. Default 3s. Kalau status berubah, useEffect re-run dengan
  // interval baru (dependency).
  const pollInterval =
    purchase?.status === "pending_payment"
      ? 2000
      : purchase?.status === "pending_provisioning"
      ? 5000
      : 3000;

  // Polling loop.
  useEffect(() => {
    if (!ready || !jobId) return;
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    async function fetchOnce() {
      try {
        const p = await api<Purchase>(`/api/v1/domains/purchases/${jobId}`);
        if (cancelled) return;
        setPurchase(p);
        setErr(null);
        setNotFound(false);
      } catch (e) {
        if (cancelled) return;
        // 404 = job lookup failed (dihapus / URL salah). Tampilkan screen
        // khusus supaya user tidak stuck lihat "HTTP 404" mentah + biar tahu
        // apa yang harus dilakukan (mulai pembelian baru).
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
          setErr(null);
          return;
        }
        setErr((e as Error).message);
      }
    }
    fetchOnce();

    // Adaptive polling: pending_payment butuh feedback cepat supaya
    // payment_url segera muncul → 2s. Provisioning EPP CREATE bisa lambat
    // (network + registry) → 5s cukup untuk hemat request. Default 3s.
    // Interval di-reset saat status berubah (useEffect dep di bawah).
    const iv = setInterval(() => {
      const cur = purchaseRef.current;
      if (cur && isTerminal(cur.status)) return; // ideally cleared, but idempotent
      // Kalau job tidak ada, no point polling lagi — biar interval idle.
      if (notFoundRef.current) return;
      fetchOnce();
    }, pollInterval);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, jobId, pollInterval]);

  // Small ref so setInterval can peek latest state without dependency loop.
  const purchaseRef = useRef<Purchase | null>(null);
  useEffect(() => {
    purchaseRef.current = purchase;
  }, [purchase]);
  const notFoundRef = useRef(false);
  useEffect(() => {
    notFoundRef.current = notFound;
  }, [notFound]);

  // Retry — hit backend proxy, biarkan polling loop pickup status baru.
  async function onRetry() {
    if (!jobId || retrying) return;
    setErr(null);
    setRetrying(true);
    try {
      await api(`/api/v1/domains/purchases/${jobId}/retry`, { method: "POST" });
      toast.success("Retry dikirim ke registrar — status akan update otomatis");
      // Force segera refresh; polling loop akan lanjut setelah ini.
      try {
        const fresh = await api<Purchase>(`/api/v1/domains/purchases/${jobId}`);
        setPurchase(fresh);
      } catch {
        /* diamkan, polling akan pickup */
      }
    } catch (e) {
      // Detect "job tidak bisa di-retry" — bisa datang sebagai 409 direct
      // (backend proxy status baru) atau embedded di 502 message (backend
      // lama). Pattern-match message untuk cover keduanya.
      const raw = (e as Error).message;
      const isUnrecoverable =
        raw.toLowerCase().includes("invoice_id atau domain_row_id") ||
        raw.toLowerCase().includes("mungkin gagal sebelum payment");
      if (isUnrecoverable || (e instanceof ApiError && e.status === 409)) {
        const msg = friendlyRetryConflict(raw);
        setErr(msg);
        toast.error(msg);
        // Cegah user click retry lagi — tombol akan hidden, ganti Mulai baru.
        if (isUnrecoverable) setRetryUnrecoverable(true);
      } else {
        setErr(raw);
      }
    } finally {
      setRetrying(false);
    }
  }

  const info = purchase ? statusInfo(purchase.status, purchase.kind) : null;

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Memuat…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <ChevronLeft />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </Button>
          <span className="text-lg font-semibold">
            {purchase?.kind === "renew" ? "Status Perpanjangan Domain" : "Status Pembelian Domain"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {err && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {/* 404 = job tidak ada di sistem (URL salah / job sudah bersihkan). */}
        {notFound ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <XCircle className="size-4 text-destructive" />
                Job tidak ditemukan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Job dengan ID <code className="rounded bg-muted px-1.5 py-0.5">{jobId}</code>{" "}
                tidak ada di sistem. Kemungkinan URL salah, atau job sudah kadaluwarsa
                dan dibersihkan oleh registrar.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="gap-2">
                  <Link href="/sites/new-with-domain">
                    Beli Domain Baru
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/settings/domains">Lihat Domain Saya</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Status card */}
        {!notFound && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {purchase ? (
                <>
                  {purchase.kind === "renew" ? "Perpanjangan " : "Pembelian "}
                  <code className="rounded bg-muted px-1.5 py-0.5">{purchase.domain}</code>
                </>
              ) : (
                "Memuat status…"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {purchase && info ? (
              <div className="flex items-start gap-4">
                <StatusIcon kind={info.kind} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold">{info.label}</span>
                    {info.kind === "wait" && (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{info.hint}</p>

                  {/* Payment action */}
                  {purchase.status === "pending_payment" &&
                    purchase.payment_method !== "manual_bank" &&
                    purchase.payment_url && (
                      <Button asChild className="mt-4 gap-2">
                        <a href={purchase.payment_url} target="_blank" rel="noopener noreferrer">
                          Buka halaman pembayaran
                          <ExternalLink className="size-4" />
                        </a>
                      </Button>
                    )}
                  {purchase.status === "pending_payment" &&
                    purchase.payment_method !== "manual_bank" &&
                    !purchase.payment_url && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Menunggu link pembayaran dari gateway… halaman akan refresh otomatis.
                      </p>
                    )}
                  {purchase.status === "pending_payment" &&
                    purchase.payment_method === "manual_bank" && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Ikuti instruksi transfer di bawah. Admin akan verifikasi manual
                        setelah dana masuk (biasanya 1×24 jam kerja).
                      </p>
                    )}

                  {/* Pending provisioning stuck (>60s) → offer manual retry.
                      Invoice sudah paid, kita cuma re-invoke ExecuteAfterPayment
                      supaya EPP execute jalan lagi. Idempotent di backend. */}
                  {purchase.status === "pending_provisioning" &&
                    purchase.updated_at &&
                    Date.now() - new Date(purchase.updated_at).getTime() > STUCK_MS && (
                      <div className="mt-4 space-y-2">
                        <p className="text-xs text-amber-700 dark:text-amber-500">
                          Proses lebih lama dari biasanya (
                          {Math.round(
                            (Date.now() - new Date(purchase.updated_at).getTime()) /
                              60000,
                          )}{" "}
                          menit). Kalau tidak berubah, coba retry manual —
                          registrar rerun proses tanpa bayar ulang.
                        </p>
                        <Button
                          onClick={onRetry}
                          disabled={retrying}
                          variant="outline"
                          className="gap-2"
                        >
                          {retrying ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              Retry…
                            </>
                          ) : (
                            <>
                              <RotateCcw className="size-4" />
                              Retry proses
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                  {/* Retry — hanya saat status=failed. TIDAK bayar ulang;
                      invoice lama tetap valid, registrar re-run EPP CREATE.
                      "Mulai baru" tersedia untuk semua terminal state (failed/expired)
                      supaya user tidak stuck kalau retry berkali-kali gagal atau
                      window pembayaran habis. Domain di-prefill ke wizard. */}
                  {purchase.status === "failed" && (
                    <>
                      {purchase.reason && (
                        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          <strong>Detail:</strong> {purchase.reason}
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {/* Retry cuma muncul kalau bukan "unrecoverable"
                            (gagal sebelum payment init). Setelah 1x klik yang
                            balik 409, retryUnrecoverable=true → hide + fokus
                            ke Mulai baru. */}
                        {!retryUnrecoverable && (
                          <Button
                            onClick={onRetry}
                            disabled={retrying}
                            className="gap-2"
                            variant="outline"
                          >
                            {retrying ? (
                              <>
                                <Loader2 className="size-4 animate-spin" />
                                Mencoba lagi…
                              </>
                            ) : (
                              <>
                                <RotateCcw className="size-4" />
                                Coba lagi
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          asChild
                          variant={retryUnrecoverable ? "default" : "ghost"}
                          className="gap-2"
                        >
                          <Link href={`/sites/new-with-domain?domain=${encodeURIComponent(purchase.domain)}`}>
                            Mulai pembelian baru
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </div>
                    </>
                  )}

                  {/* Expired: window bayar habis. Tidak ada retry (butuh invoice
                      baru) — hanya "Mulai baru". */}
                  {purchase.status === "expired" && (
                    <Button asChild className="mt-4 gap-2">
                      <Link href={`/sites/new-with-domain?domain=${encodeURIComponent(purchase.domain)}`}>
                        Mulai pembelian baru
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  )}

                  {/* Cancelled: user batalkan sebelum bayar. Sama seperti expired
                      — tidak bisa retry job lama, harus create baru. */}
                  {purchase.status === "cancelled" && (
                    <Button asChild className="mt-4 gap-2">
                      <Link href={`/sites/new-with-domain?domain=${encodeURIComponent(purchase.domain)}`}>
                        Mulai pembelian baru
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Menghubungi registrar…
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* Manual bank instructions — hanya saat pending_payment + method=manual_bank */}
        {purchase?.status === "pending_payment" &&
          purchase.payment_method === "manual_bank" && (
            <ManualBankInstructions jobId={jobId} domain={purchase.domain} />
          )}

        {/* Document picker — hanya saat status=pending_document */}
        {purchase?.status === "pending_document" && (
          <DocumentUpload
            jobId={jobId}
            domain={purchase.domain}
            onSubmitted={() => {
              // Kick fresh fetch supaya user melihat status advance segera.
              (async () => {
                try {
                  const fresh = await api<Purchase>(`/api/v1/domains/purchases/${jobId}`);
                  setPurchase(fresh);
                } catch (e) {
                  console.warn("refresh after doc attach failed", e);
                }
              })();
            }}
          />
        )}

        {/* Template picker — hanya untuk REGISTER yang baru active DAN
            belum ada situs (site_id null). Kalau sudah attached, tampil
            "situs sudah dibuat" + link edit alih-alih picker (cegah bug
            "coba attach 2x" + kejelasan UX). */}
        {purchase?.status === "active" && purchase.kind === "register" && !purchase.site_id && (
          <TemplatePicker
            jobId={jobId}
            domain={purchase.domain}
            onCreated={(siteId) => router.push(`/sites/${siteId}/editor`)}
          />
        )}
        {purchase?.status === "active" && purchase.kind === "register" && purchase.site_id && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-emerald-500" />
                Situs sudah dibuat
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Domain <code>{purchase.domain}</code> sudah ter-attach ke situs
                Anda. Lanjut edit atau kembali ke dashboard.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="gap-2">
                  <Link href={`/sites/${purchase.site_id}/editor`}>
                    Edit situs
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard">Ke Dashboard</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Renew active → congratulate + link ke Domain Saya. Site sudah ada
            dari register sebelumnya; user tidak perlu buat baru. */}
        {purchase?.status === "active" && purchase.kind === "renew" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-emerald-500" />
                Perpanjangan berhasil
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Domain <code>{purchase.domain}</code> berhasil diperpanjang. Tanggal
                expire terupdate otomatis.
              </p>
              <Button asChild className="gap-2">
                <Link href="/settings/domains">
                  Kembali ke Domain Saya
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function StatusIcon({ kind }: { kind: "wait" | "ok" | "bad" }) {
  if (kind === "ok") return <CheckCircle2 className="size-8 text-emerald-500" />;
  if (kind === "bad") return <XCircle className="size-8 text-destructive" />;
  return <Clock className="size-8 text-amber-500" />;
}

// -------------- Template picker (inline, disederhanakan) --------------
// Bukan replikasi wizard 3-step di dashboard — user sudah putuskan beli domain,
// jadi tinggal pilih template + slug default (dari domain) → create.

function TemplatePicker({
  jobId,
  domain,
  onCreated,
}: {
  jobId: string;
  domain: string;
  onCreated: (siteId: string) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<Template | null>(null);
  // Nama situs default dari SLD domain (mis. "myshop" dari "myshop.co.id").
  // User bisa edit — slug backend auto-generate dari nama ini (internal only,
  // tidak jadi URL karena free-subdomain flow sudah dihapus).
  const defaultName = useMemo(() => {
    const sld = domain.split(".")[0] ?? "";
    // Capitalize supaya UX lebih natural sebagai "nama toko".
    return sld.charAt(0).toUpperCase() + sld.slice(1);
  }, [domain]);
  const [name, setName] = useState(defaultName);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Template[]>("/api/v1/templates", { auth: false })
      // Product focus is UMKM shops; other categories stay hidden from the picker.
      .then((all) => setTemplates(all.filter((t) => t.category === "umkm")))
      .catch(() => {});
  }, []);

  async function onCreate() {
    if (!selected) return;
    setErr(null);
    setCreating(true);
    try {
      // Backend enforces atomic create + attach: kirim job_id, server verify
      // purchase active + belum di-attach, lalu create site + attach dalam
      // satu request. Slug auto-generate dari name di backend (tidak dikirim).
      const site = await api<{ id: string; slug: string }>(
        `/api/v1/sites/from-template/${selected}`,
        { method: "POST", body: JSON.stringify({ name, job_id: jobId }) },
      );
      toast.success("Situs berhasil dibuat");
      onCreated(site.id);
    } catch (e) {
      setErr((e as Error).message);
      setCreating(false);
    }
  }

  // Group template by category untuk tampilan lebih rapi.
  const byCategory = useMemo(() => {
    const m: Record<string, Template[]> = {};
    for (const t of templates) {
      (m[t.category] ??= []).push(t);
    }
    return m;
  }, [templates]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          Pilih template untuk <code className="text-xs">{domain}</code>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {Object.entries(byCategory).map(([cat, list]) => (
          <div key={cat}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {cat}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {list.map((t) => (
                <div
                  key={t.slug}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(t.slug)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(t.slug);
                    }
                  }}
                  className={`group relative cursor-pointer rounded-lg border p-3 text-left transition-colors hover:border-primary ${
                    selected === t.slug ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
                  }`}
                >
                  <div className="pr-14 text-sm font-medium">{t.name}</div>
                  <div className="mt-0.5 line-clamp-2 pr-14 text-xs text-muted-foreground">
                    {t.description}
                  </div>
                  {/* Preview button — stopPropagation supaya tidak trigger
                      select saat klik. Absolute di kanan-atas card. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewTarget(t);
                    }}
                    className="absolute right-2 top-2 rounded-md border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity hover:border-primary hover:text-primary group-hover:opacity-100"
                    aria-label={`Preview ${t.name}`}
                  >
                    Preview
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {selected && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nama situs</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Toko Bahagia"
                maxLength={128}
              />
              <p className="text-[11px] text-muted-foreground">
                Nama tampil di dashboard + judul default halaman. Bisa diubah nanti.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant="secondary" className="text-xs">
                Domain <code>{domain}</code> otomatis di-attach
              </Badge>
              <Button onClick={onCreate} disabled={creating || !name.trim()} className="gap-2">
                {creating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Membuat…
                  </>
                ) : (
                  <>
                    Buat situs
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {err && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}
      </CardContent>

      {/* Preview modal — dipicu klik "Preview" di card. onSelect = pilih
          template ini + close modal. */}
      <TemplatePreviewModal
        open={previewTarget !== null}
        slug={previewTarget?.slug ?? ""}
        name={previewTarget?.name ?? ""}
        description={previewTarget?.description}
        onClose={() => setPreviewTarget(null)}
        onSelect={() => {
          if (previewTarget) setSelected(previewTarget.slug);
        }}
      />
    </Card>
  );
}

// -------------- Document upload (status=pending_document) --------------
// Registrar meminta KTP/NPWP untuk domain .id. Web builder = passthrough:
// file dari browser di-forward langsung ke registrar via multipart,
// TIDAK disimpan di web builder (single source of truth = registrar).
//
// User upload fresh setiap kali ada job yang butuh dokumen — no library
// concept (menghindari duplikasi PII di 2 sistem).

const DOC_MAX_BYTES = 8 * 1024 * 1024;
const DOC_ALLOWED_MIMES = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

type DocCategory = { id: number; name: string; parent_id?: number };

function DocumentUpload({
  jobId,
  domain,
  onSubmitted,
}: {
  jobId: string;
  domain: string;
  onSubmitted: () => void;
}) {
  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [categoryID, setCategoryID] = useState<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Categories dari documents_local (V2). Section ini hanya render untuk
    // legacy job status="pending_document" — di V2 flow dokumen pre-attach
    // di purchase step, jadi state ini biasanya tidak ketemu.
    api<DocCategory[]>("/api/v1/documents/categories")
      .then((list) => {
        setCategories(list ?? []);
        if (list && list.length > 0) setCategoryID(list[0].id);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!file) {
      setErr("Pilih file KTP dulu");
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      setErr("File terlalu besar (max 8 MiB)");
      return;
    }
    if (!DOC_ALLOWED_MIMES.includes(file.type)) {
      setErr("Format tidak didukung — hanya PNG, JPG, atau PDF");
      return;
    }
    if (!categoryID) {
      setErr("Pilih kategori dokumen");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category_id", String(categoryID));
      // Upload ke library dokumen lokal — di flow self-sufficient tidak ada
      // "attach ke job" (dokumen di-review out-of-band oleh admin). File tetap
      // tersimpan supaya bisa di-pre-attach di purchase berikutnya.
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE ?? "http://api.localhost"}/api/v1/documents`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
          body: fd,
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success("Dokumen tersimpan di library");
      // Reset form + biar caller refresh status.
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-amber-600" />
          Upload dokumen untuk <code className="text-xs">{domain}</code>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Domain <code>{domain}</code> butuh verifikasi identitas (KTP/NPWP sesuai
          regulasi Kemenkominfo). Upload dokumen di bawah — akan tersimpan di
          library dokumen Anda + di-review oleh admin.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-category">Kategori dokumen</Label>
            <select
              id="doc-category"
              value={categoryID}
              onChange={(e) => setCategoryID(Number(e.target.value))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              disabled={categories.length === 0}
            >
              {categories.length === 0 ? (
                <option value={0}>Kategori tidak tersedia</option>
              ) : (
                categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-file">File (PNG, JPG, atau PDF · max 8 MiB)</Label>
            <input
              ref={fileInputRef}
              id="doc-file"
              type="file"
              accept={DOC_ALLOWED_MIMES.join(",")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground hover:file:bg-primary/90"
            />
            {file && (
              <p className="mt-1 text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          {err && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <div className="flex items-center justify-end">
            <Button
              type="submit"
              disabled={submitting || !file || !categoryID}
              className="gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Mengirim…
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Kirim dokumen
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// -------------- Manual bank instructions (status=pending_payment + method=manual_bank) --------------
// Tampilkan: total, rekening tujuan (dari /payment-methods config), berita
// transfer (= invoice number / job_id), dan optional admin markdown notes.
//
// User transfer sendiri, admin verifikasi via /admin/wallet/topups atau
// /admin/invoices → mark-paid. Tidak ada auto-verify (manual flow by design).

function ManualBankInstructions({ jobId, domain }: { jobId: string; domain: string }) {
  const [invoice, setInvoice] = useState<InvoiceInfo | null>(null);
  const [method, setMethod] = useState<PaymentMethodInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // job_id = invoice_id di V2 flow (single source of truth).
        const [inv, methods] = await Promise.all([
          api<InvoiceInfo>(`/api/v1/invoices/${jobId}`).catch(() => null),
          api<{ items: PaymentMethodInfo[] }>("/api/v1/payment-methods").catch(
            () => ({ items: [] }),
          ),
        ]);
        if (cancelled) return;
        if (inv) setInvoice(inv);
        const mb = methods.items.find((m) => m.code === "manual_bank");
        if (mb) setMethod(mb);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
      toast.success(`${label} disalin`);
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  const banks = method?.config?.banks ?? [];
  const adminNotes = method?.config?.instructions_md ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4 text-primary" />
          Cara pembayaran — Transfer Bank
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat instruksi…
          </div>
        ) : (
          <>
            {/* Info baris: total + berita transfer */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Total transfer
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-2xl font-bold tracking-tight">
                      {invoice ? formatIDR(invoice.total) : "—"}
                    </span>
                    {invoice && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copy(String(invoice.total), "Nominal")}
                        className="h-7 gap-1 px-2 text-xs"
                      >
                        {copied === "Nominal" ? (
                          <Check className="size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Berita transfer <span className="text-destructive">*</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="max-w-full truncate rounded bg-background px-2 py-1 font-mono text-xs">
                      {invoice?.number ?? jobId}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copy(invoice?.number ?? jobId, "Berita transfer")
                      }
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      {copied === "Berita transfer" ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <strong>Wajib</strong> isi berita transfer persis seperti di atas
                  supaya pembayaran dapat kami cocokkan otomatis.
                </span>
              </div>
            </div>

            {/* Bank list */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Transfer ke salah satu rekening
              </div>
              {banks.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                  Rekening bank belum dikonfigurasi oleh admin. Silakan hubungi
                  support.
                </div>
              ) : (
                <ul className="space-y-2">
                  {banks.map((b, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {b.name}
                          </Badge>
                          <code className="font-mono text-sm font-semibold">
                            {b.account_number}
                          </code>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          a.n. {b.account_holder}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copy(b.account_number, `Rekening ${b.name}`)}
                        className="gap-1.5"
                      >
                        {copied === `Rekening ${b.name}` ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        Salin
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Admin notes (markdown-lite, render as pre-line) */}
            {adminNotes && (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Info className="size-3" />
                  Catatan admin
                </div>
                <p className="whitespace-pre-line text-sm text-muted-foreground">
                  {adminNotes}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Setelah transfer, admin akan verifikasi manual dan status pembelian{" "}
              <code>{domain}</code> akan otomatis lanjut ke tahap provisioning.
              Halaman ini akan refresh otomatis.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatIDR(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

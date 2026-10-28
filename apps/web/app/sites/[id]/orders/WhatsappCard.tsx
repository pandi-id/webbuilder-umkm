"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, MessageCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { WA_PLACEHOLDER, api, errMessage, updateSiteWhatsapp } from "@/lib/api";
import { formatWa } from "@/components/orders/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WhatsappCard({ siteId }: { siteId: string }) {
  // undefined = still loading; null = failed to load.
  const [number, setNumber] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ whatsapp_number?: string }>(`/api/v1/sites/${siteId}`)
      .then((s) => !cancelled && setNumber(s.whatsapp_number ?? ""))
      .catch(() => !cancelled && setNumber(null));
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  function startEdit() {
    setDraft(number && number !== WA_PLACEHOLDER ? formatWa(number) : "");
    setErr(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const updated = await updateSiteWhatsapp(siteId, draft.trim());
      // Fall back to a digits-only guess if the API omits the field in its response.
      const next =
        typeof updated?.whatsapp_number === "string"
          ? updated.whatsapp_number
          : draft.replace(/\D/g, "").replace(/^0/, "62");
      setNumber(next);
      setEditing(false);
      toast.success(next ? "Nomor WhatsApp tersimpan" : "Nomor WhatsApp dikosongkan");
    } catch (e) {
      setErr(errMessage(e, "Gagal menyimpan nomor"));
    } finally {
      setSaving(false);
    }
  }

  const loading = number === undefined;
  const isEmpty = number === "";
  const isPlaceholder = number === WA_PLACEHOLDER;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <MessageCircle className="size-5" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Nomor WhatsApp untuk pesanan</CardTitle>
            <CardDescription className="mt-1">
              Pesanan dari keranjang dikirim ke nomor ini. Kosong = pesanan tetap tercatat di sini,
              tapi pembeli tidak diarahkan ke WhatsApp.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="h-10 w-full max-w-sm animate-pulse rounded-md bg-muted/50" />
        ) : editing ? (
          <form onSubmit={save} className="space-y-1.5">
            <Label htmlFor="wa-number">Nomor WhatsApp</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="wa-number"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="0812-3456-7890"
                className="sm:max-w-xs"
                aria-invalid={!!err}
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  Simpan
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="flex-1 sm:flex-none"
                >
                  Batal
                </Button>
              </div>
            </div>
            {err ? (
              <p className="text-sm text-destructive">{err}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Boleh diawali 0, 62, atau +62. Kosongkan lalu Simpan untuk menghapus nomor.
              </p>
            )}
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {number === null ? (
                <span className="text-sm text-muted-foreground">Nomor belum bisa dimuat.</span>
              ) : isEmpty ? (
                <span className="text-sm text-muted-foreground">Belum diisi</span>
              ) : (
                <span className="text-lg font-semibold tabular-nums tracking-tight">
                  {formatWa(number)}
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={startEdit} disabled={number === null}>
              <Pencil />
              {isEmpty ? "Isi Nomor" : "Ubah"}
            </Button>
          </div>
        )}

        {!loading && !editing && (isEmpty || isPlaceholder) && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {isPlaceholder
                ? "Nomor ini masih contoh dari template. Pesanan pembeli akan terkirim ke nomor orang lain — segera ganti dengan nomor WhatsApp toko Anda."
                : "Nomor WhatsApp belum diisi. Pembeli tetap bisa memesan, tapi tidak bisa langsung chat ke toko Anda."}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

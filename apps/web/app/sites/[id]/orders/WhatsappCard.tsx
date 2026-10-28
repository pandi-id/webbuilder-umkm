"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, MessageCircle, Pencil, RotateCcw, UserRound } from "lucide-react";
import { toast } from "sonner";
import { WA_PLACEHOLDER, errMessage, getOrderSummary, updateSiteWhatsapp, type OrderSummary } from "@/lib/api";
import { formatWa } from "@/components/orders/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type WaInfo = NonNullable<OrderSummary["whatsapp"]>;

// Shows the number checkout actually uses: the shop's own number, or the
// owner's profile phone as the default so sellers don't type it twice.
export function WhatsappCard({ siteId }: { siteId: string }) {
  // undefined = still loading; null = failed to load.
  const [wa, setWa] = useState<WaInfo | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getOrderSummary(siteId);
      setWa(s.whatsapp ?? { number: "", source: "", profile: "" });
    } catch {
      setWa(null);
    }
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit() {
    setDraft(wa?.source === "site" && wa.number !== WA_PLACEHOLDER ? formatWa(wa.number) : "");
    setErr(null);
    setEditing(true);
  }

  async function saveNumber(value: string, okMessage: string) {
    setSaving(true);
    setErr(null);
    try {
      await updateSiteWhatsapp(siteId, value);
      await load();
      setEditing(false);
      toast.success(okMessage);
    } catch (e) {
      setErr(errMessage(e, "Gagal menyimpan nomor"));
    } finally {
      setSaving(false);
    }
  }

  const loading = wa === undefined;
  const source = wa?.source ?? "";
  const isPlaceholder = source === "site" && wa?.number === WA_PLACEHOLDER;

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
              Pembeli diarahkan ke nomor ini setelah checkout. Secara bawaan memakai No. HP di profil
              Anda; bisa diganti dengan nomor khusus toko ini.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="h-10 w-full max-w-sm animate-pulse rounded-md bg-muted/50" />
        ) : editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveNumber(draft.trim(), draft.trim() ? "Nomor WhatsApp toko tersimpan" : "Kembali memakai nomor profil");
            }}
            className="space-y-1.5"
          >
            <Label htmlFor="wa-number">Nomor WhatsApp khusus toko</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="wa-number"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={wa?.profile ? formatWa(wa.profile) : "0812-3456-7890"}
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
                Boleh diawali 0, 62, atau +62. Kosongkan lalu Simpan untuk kembali memakai No. HP profil.
              </p>
            )}
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {wa === null ? (
                <span className="text-sm text-muted-foreground">Nomor belum bisa dimuat.</span>
              ) : source === "" ? (
                <span className="text-sm text-muted-foreground">Belum ada nomor</span>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold tabular-nums tracking-tight">{formatWa(wa!.number)}</span>
                    <Badge variant={source === "site" ? "secondary" : "outline"}>
                      {source === "site" ? "Khusus toko" : "Dari profil"}
                    </Badge>
                  </div>
                  {source === "profile" && (
                    <p className="text-xs text-muted-foreground">
                      Ikut No. HP di{" "}
                      <Link href="/settings/profile" className="underline underline-offset-2 hover:text-foreground">
                        profil Anda
                      </Link>{" "}
                      — kalau profil diubah, nomor ini ikut berubah.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {source === "site" && wa?.profile && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => void saveNumber("", "Kembali memakai nomor profil")}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  Pakai nomor profil
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={startEdit} disabled={wa === null}>
                <Pencil />
                {source === "site" ? "Ubah" : source === "profile" ? "Pakai nomor lain" : "Isi Nomor"}
              </Button>
            </div>
          </div>
        )}

        {!loading && !editing && (source === "" || isPlaceholder) && wa !== null && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {isPlaceholder ? (
                "Nomor ini masih contoh dari template. Pesanan pembeli akan terkirim ke nomor orang lain — segera ganti dengan nomor WhatsApp toko Anda."
              ) : (
                <>
                  Belum ada nomor WhatsApp. Pembeli tetap bisa memesan, tapi tidak bisa langsung chat ke
                  toko Anda. Isi nomor di sini, atau lengkapi No. HP di{" "}
                  <Link href="/settings/profile" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                    <UserRound className="size-3.5" />
                    Profil
                  </Link>
                  .
                </>
              )}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

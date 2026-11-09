"use client";

// Dialogs for the two account actions that change who can do what on the
// platform. Shared by the user list and the user detail page so both carry the
// same friction — the list used to promote on a single unconfirmed click.

import { useEffect, useState } from "react";
import { Ban, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type AccessTarget = { id: string; email: string; name?: string };

// Promote — the admin must retype the target's email. The API checks the same
// value, so a stray click or a buggy caller cannot grant admin either.
export function PromoteAdminDialog({
  target,
  onClose,
  onDone,
}: {
  target: AccessTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTyped("");
    setErr(null);
  }, [target?.id]);

  const matches =
    !!target && typed.trim().toLowerCase() === target.email.trim().toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !matches) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/v1/admin/users/${target.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: "admin", confirm_email: typed.trim() }),
      });
      toast.success(`${target.email} kini admin`);
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-600" />
              Jadikan admin?
            </DialogTitle>
            <DialogDescription>
              {target?.name ? `${target.name} — ` : ""}
              <span className="font-mono">{target?.email}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-medium">Admin punya akses penuh ke seluruh platform:</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              <li>membuka dan mengubah situs milik semua pengguna</li>
              <li>menghapus pengguna dan situs</li>
              <li>mengatur harga, pembayaran, dan saldo wallet</li>
              <li>menjadikan orang lain admin</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promote-confirm">
              Ketik <span className="font-mono font-semibold">{target?.email}</span> untuk
              konfirmasi
            </Label>
            <Input
              id="promote-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>

          {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button
              type="submit"
              disabled={!matches || busy}
              className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Jadikan Admin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Suspend — reversible lock. Reason is optional but lands in the audit log and
// on the user's row, so the next admin knows why.
export function SuspendUserDialog({
  target,
  onClose,
  onDone,
}: {
  target: AccessTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setErr(null);
  }, [target?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/v1/admin/users/${target.id}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast.success(`${target.email} ditangguhkan`);
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="size-5 text-destructive" />
              Tangguhkan akun?
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono">{target?.email}</span>
            </DialogDescription>
          </DialogHeader>

          <ul className="my-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Tidak bisa login — lewat password, Google, maupun undangan.</li>
            <li>Semua sesi dicabut. Sesi yang sedang terbuka berakhir paling lambat 15 menit.</li>
            <li>
              Akun, situs, dan domain <strong className="text-foreground">tidak dihapus</strong>.
              Bisa diaktifkan kembali kapan saja.
            </li>
          </ul>

          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">Alasan (opsional)</Label>
            <Textarea
              id="suspend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="mis. Akun spam pendaftaran massal"
            />
            <p className="text-xs text-muted-foreground">
              Tercatat di audit log dan terlihat oleh admin lain.
            </p>
          </div>

          {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Tangguhkan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The two low-risk counterparts. Demote and unsuspend only narrow access, so a
// plain confirm is enough friction.
export async function demoteAdmin(t: AccessTarget): Promise<boolean> {
  if (!confirm(`Turunkan ${t.email} dari admin? Akun kembali menjadi klien biasa.`)) return false;
  try {
    await api(`/api/v1/admin/users/${t.id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role: "client" }),
    });
    toast.success(`${t.email} bukan admin lagi`);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

export async function unsuspendUser(t: AccessTarget): Promise<boolean> {
  if (!confirm(`Aktifkan kembali ${t.email}? Mereka bisa login lagi.`)) return false;
  try {
    await api(`/api/v1/admin/users/${t.id}/unsuspend`, { method: "POST" });
    toast.success(`${t.email} aktif kembali`);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

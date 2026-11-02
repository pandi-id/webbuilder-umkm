"use client";

// InviteMemberDialog — site owner grants an existing account editor/viewer
// access. Only accounts that already exist can be invited: the lookup is
// exact-email and never returns a list, so a site owner cannot use it to walk
// the platform's user base.

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Info,
  Loader2,
  SquarePen,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { addSiteMember, lookupMemberCandidate, type MemberLookup } from "@/lib/api";
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
import { useDebounced } from "@/components/Pagination";

type Role = "editor" | "viewer";

const ROLES: { value: Role; label: string; hint: string; icon: React.ElementType }[] = [
  {
    value: "editor",
    label: "Editor",
    hint: "Bisa mengubah isi situs dan mempublikasikan.",
    icon: SquarePen,
  },
  {
    value: "viewer",
    label: "Viewer",
    hint: "Hanya bisa melihat situs dan statistiknya.",
    icon: Eye,
  },
];

function LookupHint({ lookup }: { lookup: MemberLookup }) {
  if (!lookup.eligible) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <AlertCircle className="size-3.5 shrink-0 translate-y-px" />
        <span>{lookup.reason || "Email ini tidak bisa ditambahkan."}</span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-emerald-700">
      <CheckCircle2 className="size-3.5 shrink-0 translate-y-px" />
      <span>
        Akun ditemukan{lookup.name ? <strong> — {lookup.name}</strong> : null}. Akses
        langsung aktif setelah Anda menambahkannya.
      </span>
    </p>
  );
}

export function InviteMemberDialog({
  siteId,
  open,
  onOpenChange,
  onAdded,
}: {
  siteId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [lookup, setLookup] = useState<MemberLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debouncedEmail = useDebounced(email, 400);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setRole("editor");
      setLookup(null);
      setErr(null);
    }
  }, [open]);

  useEffect(() => {
    const addr = debouncedEmail.toLowerCase().trim();
    if (!open || !addr.includes("@")) {
      setLookup(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    lookupMemberCandidate(siteId, addr)
      .then((r) => !cancelled && setLookup(r))
      .catch(() => !cancelled && setLookup(null))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedEmail, open, siteId]);

  const blocked = useMemo(
    () => checking || saving || lookup?.eligible === false || !email.includes("@"),
    [checking, saving, lookup, email],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const res = await addSiteMember(siteId, email.toLowerCase().trim(), role);
      toast.success(`${res.name || res.email} kini ${res.role} di situs ini`, {
        description: "Kami sudah mengirim pemberitahuan ke email mereka.",
      });
      onOpenChange(false);
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undang Kolaborator</DialogTitle>
          <DialogDescription>
            Beri akses ke orang yang Anda percaya — rekan, staf, atau agen. Mereka
            harus sudah punya akun Web Builder.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="member-email">Email *</Label>
            <Input
              id="member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rekan@example.com"
              autoComplete="off"
            />
            {checking && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Memeriksa email…
              </p>
            )}
            {!checking && lookup && <LookupHint lookup={lookup} />}
            {!checking && !lookup && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="size-3.5 shrink-0 translate-y-px" />
                <span>Masukkan email lengkap akun mereka.</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Peran</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLES.map((r) => {
                const Icon = r.icon;
                const active = role === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    aria-pressed={active}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="size-3.5" />
                      {r.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {r.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {err}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button type="submit" disabled={blocked} className="gap-1.5">
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              Beri Akses
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

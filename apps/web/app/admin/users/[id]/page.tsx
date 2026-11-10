"use client";

// Admin: Detail user lengkap dengan tab. Overview, Situs, Aktivitas (audit log).
// Role-specific hint: kalau reseller → link ke /admin/resellers/:id supaya
// admin bisa lihat portfolio bisnis (klien + agent + domain).

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Briefcase,
  Building2,
  CheckCircle2,
  CircleCheck,
  Clock,
  ExternalLink,
  Globe2,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Printer,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCircle,
} from "lucide-react";
import { toast } from "sonner";
import { api, openBlob } from "@/lib/api";
import {
  PromoteAdminDialog,
  SuspendUserDialog,
  demoteAdmin,
  unsuspendUser,
  type AccessTarget,
} from "@/components/admin/UserAccessDialogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CitySelect, ProvinceSelect } from "@/components/WilayahSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type UserDetail = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user" | "client" | "reseller" | "agent";
  created_at: string;
  email_verified_at?: string;
  phone_number?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  nik?: string;
  parent_reseller_id?: string;
  reseller_display_name?: string;
  reseller_status?: string;
  reseller_tier?: string;
  has_password_login: boolean;
  has_google_login: boolean;
  has_eid_login: boolean;
  suspended_at?: string | null;
  suspended_reason?: string;
  site_count: number;
  published_sites: number;
  domain_count: number;
};

type SiteRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type AuditEntry = {
  id: string;
  event: string;
  actor_email?: string;
  target_type?: string;
  target_id?: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

const ROLE_LABEL: Record<string, { label: string; className: string }> = {
  admin: { label: "Admin", className: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400" },
  reseller: { label: "Reseller", className: "bg-primary/10 text-primary" },
  agent: { label: "Agent", className: "bg-blue-500/10 text-blue-600" },
  client: { label: "Client", className: "bg-muted text-muted-foreground" },
  user: { label: "User (legacy)", className: "bg-muted text-muted-foreground" },
};

function avatarInit(name: string, email: string): string {
  const src = name?.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = await api<UserDetail>(`/api/v1/admin/users/${id}`);
      setUser(u);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Same dialogs as the user list: promote needs the email retyped, suspend
  // explains its effect. A bare confirm() was all that stood in front of admin.
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    api<{ id: string }>("/api/v1/auth/me")
      .then((m) => setMeId(m.id))
      .catch(() => {});
  }, []);

  async function runQuick(fn: (t: AccessTarget) => Promise<boolean>) {
    if (!user) return;
    setActing(true);
    try {
      if (await fn(user)) refresh();
    } finally {
      setActing(false);
    }
  }

  async function remove() {
    if (!user) return;
    if (
      !confirm(
        `Hapus akun ${user.email}?\n\nSemua situs miliknya juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`,
      )
    )
      return;
    setActing(true);
    try {
      await api(`/api/v1/admin/users/${id}`, { method: "DELETE" });
      toast.success(`Akun ${user.email} berhasil dihapus`);
      router.push("/admin/users");
    } catch (e) {
      toast.error((e as Error).message);
      setActing(false);
    }
  }

  if (loading && !user) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Memuat detail user…
      </div>
    );
  }

  if (err && !user) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/admin/users">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <span>{err}</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const roleInfo = ROLE_LABEL[user.role] ?? { label: user.role, className: "bg-muted" };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/admin/users">
            <ArrowLeft className="size-4" />
            Daftar Pengguna
          </Link>
        </Button>
      </div>

      {/* Header card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                {avatarInit(user.name, user.email)}
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight">
                  {user.name || (
                    <span className="italic text-muted-foreground">Tanpa nama</span>
                  )}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1 font-mono">
                    <Mail className="size-3.5" />
                    {user.email}
                  </span>
                  {user.phone_number && (
                    <span className="flex items-center gap-1 font-mono">
                      <Phone className="size-3.5" />
                      {user.phone_number}
                    </span>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className={`gap-1 text-xs ${roleInfo.className}`}>
                    {user.role === "admin" ? (
                      <ShieldCheck className="size-3" />
                    ) : user.role === "reseller" ? (
                      <Briefcase className="size-3" />
                    ) : user.role === "agent" ? (
                      <UserCircle className="size-3" />
                    ) : (
                      <UserCircle className="size-3" />
                    )}
                    {roleInfo.label}
                  </Badge>
                  {user.email_verified_at ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                      <CheckCircle2 className="size-3" />
                      Email verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                      <Clock className="size-3" />
                      Email belum verified
                    </span>
                  )}
                  {user.has_google_login && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600">
                      Google linked
                    </span>
                  )}
                  {user.has_eid_login && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] text-red-600">
                      e.id linked
                    </span>
                  )}
                  {!user.has_password_login && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      OAuth only
                    </span>
                  )}
                  {user.suspended_at && (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <Ban className="size-3" />
                      Ditangguhkan sejak{" "}
                      {new Date(user.suspended_at).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {user.suspended_reason ? ` — ${user.suspended_reason}` : ""}
                    </Badge>
                  )}
                  {user.role === "reseller" && (
                    <Button size="sm" variant="ghost" asChild className="h-6 gap-1 text-xs">
                      <Link href={`/admin/resellers/${user.id}`}>
                        Portfolio reseller
                        <ExternalLink className="size-3" />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.id === meId ? null : user.role === "admin" ? (
                <Button
                  variant="outline"
                  onClick={() => runQuick(demoteAdmin)}
                  disabled={acting}
                  className="gap-1.5"
                >
                  {acting ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldOff className="size-3.5" />}
                  Turunkan dari admin
                </Button>
              ) : (
                <>
                  {/* Outline, not primary: granting admin must not be the
                      page's most prominent call to action. */}
                  {(user.role === "client" || user.role === "user") && !user.suspended_at && (
                    <Button
                      variant="outline"
                      onClick={() => setPromoteOpen(true)}
                      disabled={acting}
                      className="gap-1.5"
                    >
                      <ShieldCheck className="size-3.5" />
                      Jadikan admin…
                    </Button>
                  )}
                  {user.suspended_at ? (
                    <Button
                      variant="outline"
                      onClick={() => runQuick(unsuspendUser)}
                      disabled={acting}
                      className="gap-1.5"
                    >
                      {acting ? <Loader2 className="size-3.5 animate-spin" /> : <CircleCheck className="size-3.5" />}
                      Aktifkan kembali
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setSuspendOpen(true)}
                      disabled={acting}
                      className="gap-1.5"
                    >
                      <Ban className="size-3.5" />
                      Tangguhkan
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="outline"
                onClick={remove}
                disabled={acting}
                className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {acting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Hapus
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Globe2} label="Total Situs" value={String(user.site_count)} />
        <StatTile
          icon={CheckCircle2}
          label="Situs Dipublikasi"
          value={String(user.published_sites)}
        />
        <StatTile icon={Building2} label="Domain Aktif" value={String(user.domain_count)} />
        <StatTile
          icon={KeyRound}
          label="Metode Login"
          value={
            [
              user.has_password_login && "Password",
              user.has_google_login && "Google",
              user.has_eid_login && "e.id",
            ]
              .filter(Boolean)
              .join(" + ") || "—"
          }
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start bg-muted/40">
          <TabsTrigger value="overview">Detail</TabsTrigger>
          <TabsTrigger value="sites">
            Situs
            {user.site_count > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">
                {user.site_count}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="invoices">Invoice</TabsTrigger>
          <TabsTrigger value="activity">Aktivitas</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab user={user} onUpdated={refresh} />
        </TabsContent>
        <TabsContent value="sites" className="mt-4">
          {tab === "sites" && <SitesTab id={id} />}
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          {tab === "invoices" && <InvoicesTab id={id} />}
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          {tab === "activity" && <ActivityTab id={id} />}
        </TabsContent>
      </Tabs>
      <PromoteAdminDialog
        target={promoteOpen ? user : null}
        onClose={() => setPromoteOpen(false)}
        onDone={refresh}
      />
      <SuspendUserDialog
        target={suspendOpen ? user : null}
        onClose={() => setSuspendOpen(false)}
        onDone={refresh}
      />
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2 text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function OverviewTab({
  user,
  onUpdated,
}: {
  user: UserDetail;
  onUpdated: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const hasContact = user.phone_number || user.address || user.city;
  const isResellerLike = user.role === "reseller" || user.role === "agent";
  return (
    <Card>
      <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
        <div className="sm:col-span-2 flex items-center justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="gap-1.5"
          >
            <Pencil className="size-3.5" />
            Edit profil kontak
          </Button>
        </div>
        <Section title="Identitas">
          <Row label="Nama" value={user.name || "—"} />
          <Row label="Email" value={user.email} mono />
          <Row label="Role" value={ROLE_LABEL[user.role]?.label ?? user.role} />
          <Row label="User ID" value={user.id} mono />
        </Section>
        <Section title="Kontak & Alamat">
          {hasContact ? (
            <>
              <Row label="Telepon" value={user.phone_number || "—"} mono />
              <Row label="Alamat" value={user.address || "—"} />
              <Row label="Kota" value={user.city || "—"} />
              <Row label="Provinsi" value={user.state || "—"} />
              <Row label="Kode Pos" value={user.postal_code || "—"} mono />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Belum melengkapi profil kontak. Perlu diisi sebelum bisa beli domain.
            </p>
          )}
          <Row
            label="NIK"
            value={user.nik ? `${user.nik.slice(0, 6)}••••••${user.nik.slice(-4)}` : "—"}
            mono
          />
        </Section>
        {editOpen && (
          <EditProfileDialog
            user={user}
            onClose={() => setEditOpen(false)}
            onDone={() => {
              setEditOpen(false);
              onUpdated();
            }}
          />
        )}
        {isResellerLike && (
          <Section title="Konteks Bisnis">
            {user.role === "reseller" ? (
              <>
                <Row label="Nama Bisnis" value={user.reseller_display_name || "—"} />
                <Row label="Status" value={user.reseller_status || "—"} />
                <Row label="Tier" value={user.reseller_tier || "belum di-set"} />
              </>
            ) : (
              <>
                <Row
                  label="Parent Reseller"
                  value={user.parent_reseller_id || "—"}
                  mono
                />
                {user.parent_reseller_id && (
                  <div className="pt-1">
                    <Button asChild size="sm" variant="outline" className="gap-1 text-xs">
                      <Link href={`/admin/resellers/${user.parent_reseller_id}`}>
                        Lihat reseller induk
                        <ExternalLink className="size-3" />
                      </Link>
                    </Button>
                  </div>
                )}
              </>
            )}
          </Section>
        )}
        <Section title="Timeline">
          <Row label="Daftar" value={formatDateTime(user.created_at)} />
          <Row
            label="Email verified"
            value={user.email_verified_at ? formatDateTime(user.email_verified_at) : "belum"}
          />
        </Section>
      </CardContent>
    </Card>
  );
}

// EDITABLE_FIELDS — profil + email yang admin boleh edit. Role diubah lewat
// tombol khusus (toggleRole). Password tidak di sini — pakai forgot-password.
//
// Catatan email: ganti email reset email_verified_at di DB — user harus
// verify ulang dari email baru. Dipakai untuk perbaikan typo saat daftar.
type EditableField =
  | "name"
  | "email"
  | "phone_number"
  | "address"
  | "city"
  | "state"
  | "postal_code"
  | "nik";

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

// ASCII printable check — mirror auth.IsASCIIPrintable di backend.
// Em-dash '—' / aksen / emoji di-reject supaya EPP contact:create tidak gagal
// dengan "Transaction rolled back" di PANDI side.
function isASCIIPrintable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

function countDigits(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

function fieldErrors(f: Record<EditableField, string>): Partial<Record<EditableField, string>> {
  const e: Partial<Record<EditableField, string>> = {};
  if (f.name && !isASCIIPrintable(f.name)) {
    e.name = "Nama hanya boleh karakter ASCII (tanpa aksen / em-dash / emoji)";
  }
  if (f.email) {
    const trimmed = f.email.trim();
    if (!EMAIL_RE.test(trimmed) || trimmed.length > 254) {
      e.email = "Format email tidak valid";
    }
  } else {
    e.email = "Email tidak boleh kosong";
  }
  if (f.phone_number) {
    const d = countDigits(f.phone_number);
    if (d < 7 || d > 15) e.phone_number = "Nomor HP harus 7-15 digit";
  }
  if (f.address && !isASCIIPrintable(f.address)) {
    e.address = "Alamat hanya boleh karakter ASCII";
  }
  if (f.city && !isASCIIPrintable(f.city)) {
    e.city = "Nama kota hanya boleh karakter ASCII";
  }
  if (f.state && !isASCIIPrintable(f.state)) {
    e.state = "Nama provinsi hanya boleh karakter ASCII (mis. em-dash '—')";
  }
  if (f.postal_code) {
    const d = countDigits(f.postal_code);
    const allowed = /^[0-9\s\-]+$/.test(f.postal_code);
    if (!allowed || d < 4 || d > 10) e.postal_code = "Kode pos harus 4-10 digit angka";
  }
  if (f.nik && (f.nik.length !== 16 || !/^\d{16}$/.test(f.nik))) {
    e.nik = "NIK harus 16 digit angka";
  }
  return e;
}

function EditProfileDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<Record<EditableField, string>>({
    name: user.name ?? "",
    email: user.email ?? "",
    phone_number: user.phone_number ?? "",
    address: user.address ?? "",
    city: user.city ?? "",
    state: user.state ?? "",
    postal_code: user.postal_code ?? "",
    nik: user.nik ?? "",
  });
  const [saving, setSaving] = useState(false);
  const errors = fieldErrors(form);
  const hasErrors = Object.keys(errors).length > 0;

  const dirty = (Object.keys(form) as EditableField[]).some(
    (k) => form[k] !== ((user as unknown as Record<string, string>)[k] ?? ""),
  );

  async function save() {
    if (!dirty || hasErrors) return;
    setSaving(true);
    try {
      // PATCH partial — hanya field yang berubah supaya audit log akurat
      // (fields_changed only lists what admin touched).
      const patch: Partial<Record<EditableField, string>> = {};
      (Object.keys(form) as EditableField[]).forEach((k) => {
        if (form[k] !== ((user as unknown as Record<string, string>)[k] ?? "")) {
          patch[k] = form[k];
        }
      });
      await api(`/api/v1/admin/users/${user.id}/profile`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.success("Profil kontak user tersimpan");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit profil kontak user</DialogTitle>
          <DialogDescription>
            Field kontak dipakai sebagai WHOIS + EPP contact. Hanya karakter
            ASCII — em-dash <code>—</code>, aksen, dan emoji akan ditolak
            registry PANDI. Role diubah lewat tombol khusus.
          </DialogDescription>
        </DialogHeader>

        {form.email !== (user.email ?? "") && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <strong className="block">Email akan diubah.</strong>
            User harus verify ulang dari email baru — status Email verified
            akan di-reset. Pastikan email yang baru benar milik user.
          </div>
        )}

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <EditField
            label="Nama Lengkap"
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            error={errors.name}
            maxLength={128}
            className="sm:col-span-2"
          />
          <EditField
            label="Email"
            value={form.email}
            onChange={(v) => setForm((f) => ({ ...f, email: v }))}
            error={errors.email}
            maxLength={254}
            placeholder="user@example.com"
            className="sm:col-span-2"
          />
          <EditField
            label="Nomor HP"
            value={form.phone_number}
            onChange={(v) => setForm((f) => ({ ...f, phone_number: v }))}
            error={errors.phone_number}
            maxLength={32}
            placeholder="+62812xxxxxxx"
          />
          <EditField
            label="NIK (16 digit)"
            value={form.nik}
            onChange={(v) => setForm((f) => ({ ...f, nik: v.replace(/\D/g, "").slice(0, 16) }))}
            error={errors.nik}
            maxLength={16}
          />
          <EditField
            label="Alamat"
            value={form.address}
            onChange={(v) => setForm((f) => ({ ...f, address: v }))}
            error={errors.address}
            maxLength={255}
            className="sm:col-span-2"
          />
          <div className="space-y-1">
            <Label className="text-xs">Provinsi</Label>
            {/* Ganti provinsi → reset city supaya dropdown kota accurate. */}
            <ProvinceSelect
              value={form.state}
              onChange={(v) =>
                setForm((f) => ({ ...f, state: v, city: "" }))
              }
            />
            {errors.state && (
              <p className="text-[11px] text-destructive">{errors.state}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kota / Kabupaten</Label>
            <CitySelect
              province={form.state}
              value={form.city}
              onChange={(v) => setForm((f) => ({ ...f, city: v }))}
            />
            {errors.city && (
              <p className="text-[11px] text-destructive">{errors.city}</p>
            )}
          </div>
          <EditField
            label="Kode Pos"
            value={form.postal_code}
            onChange={(v) => setForm((f) => ({ ...f, postal_code: v }))}
            error={errors.postal_code}
            maxLength={16}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={save} disabled={!dirty || hasErrors || saving} className="gap-1.5">
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Menyimpan…
              </>
            ) : (
              "Simpan"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditField({
  label,
  value,
  onChange,
  error,
  maxLength,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={!!error}
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Building2 className="size-3" />
        {title}
      </h3>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-2 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}

function SitesTab({ id }: { id: string }) {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<SiteRow[]>(`/api/v1/admin/users/${id}/sites`)
      .then((r) => setRows(r ?? []))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <ListSection loading={loading} err={err} empty={rows.length === 0} emptyLabel="User belum punya situs">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Nama</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Dibuat</TableHead>
            <TableHead>Diperbarui</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">/{s.slug}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    s.status === "published" ? "success" : s.status === "archived" ? "secondary" : "warning"
                  }
                  className="text-xs"
                >
                  {s.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(s.created_at)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(s.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListSection>
  );
}

type UserInvoice = {
  id: string;
  number: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  currency: string;
  status: string;
  payment_method: string;
  paid_at?: string;
  due_at: string;
  created_at: string;
};

const INVOICE_STATUS_VARIANT: Record<
  string,
  "success" | "secondary" | "warning" | "destructive" | "outline"
> = {
  paid: "success",
  unpaid: "warning",
  draft: "secondary",
  expired: "destructive",
  cancelled: "destructive",
  refund: "outline",
};

function InvoicesTab({ id }: { id: string }) {
  const [rows, setRows] = useState<UserInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: UserInvoice[] }>(`/api/v1/admin/users/${id}/invoices?limit=100`)
      .then((r) => setRows(r.items ?? []))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <ListSection loading={loading} err={err} empty={rows.length === 0} emptyLabel="User belum punya invoice">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-[180px]">Nomor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Dibuat</TableHead>
            <TableHead>Dibayar</TableHead>
            <TableHead className="w-0"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-mono text-xs font-medium">{inv.number}</TableCell>
              <TableCell>
                <Badge
                  variant={INVOICE_STATUS_VARIANT[inv.status] ?? "secondary"}
                  className="text-xs"
                >
                  {inv.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">{inv.payment_method}</TableCell>
              <TableCell className="text-right font-mono tabular-nums text-sm">
                {formatIDR(inv.total)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(inv.created_at)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {inv.paid_at ? formatDate(inv.paid_at) : "—"}
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Preview PDF"
                  onClick={() =>
                    openBlob(`/api/v1/admin/invoices/${inv.id}/pdf`).catch((e) =>
                      toast.error("Gagal buka PDF", { description: (e as Error).message }),
                    )
                  }
                >
                  <Printer className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListSection>
  );
}

function ActivityTab({ id }: { id: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Actor + target dua-duanya, merge in-memory (audit_log tidak support OR filter).
    Promise.all([
      api<{ items: AuditEntry[] }>(`/api/v1/admin/audit-log?actor_id=${id}&page_size=100`),
      api<{ items: AuditEntry[] }>(`/api/v1/admin/audit-log?target_id=${id}&page_size=100`),
    ])
      .then(([a, b]) => {
        const map = new Map<string, AuditEntry>();
        (a.items ?? []).forEach((e) => map.set(e.id, e));
        (b.items ?? []).forEach((e) => map.set(e.id, e));
        const merged = Array.from(map.values()).sort((x, y) =>
          y.created_at.localeCompare(x.created_at),
        );
        setEntries(merged);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <ListSection loading={loading} err={err} empty={entries.length === 0} emptyLabel="Belum ada aktivitas ter-audit">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-40">Waktu</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Aktor</TableHead>
            <TableHead>Metadata</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <Fragment key={e.id}>
              <TableRow>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(e.created_at)}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {e.event}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {e.actor_email || "system"}
                </TableCell>
                <TableCell>
                  {Object.keys(e.metadata || {}).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-primary hover:underline">
                        lihat
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 p-2 text-[10px]">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </ListSection>
  );
}

function ListSection({
  loading,
  err,
  empty,
  emptyLabel,
  children,
}: {
  loading: boolean;
  err: string | null;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Memuat…
          </div>
        ) : err ? (
          <div className="flex items-start gap-2 p-4 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
            <span>{err}</span>
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">
            <MapPin className="size-8 opacity-30" />
            {emptyLabel}
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
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

function formatIDR(v: number): string {
  return `Rp ${v.toLocaleString("id-ID")}`;
}

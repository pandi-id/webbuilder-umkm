"use client";

// ClientForm — full-page "Tambah Klien", shared by the reseller and agent
// portals (both POST the same endpoint, guarded by RequireResellerOrAgent).
//
// Replaces the old dialog: the form carries contact details that feed EPP
// contact:create at domain registration, and a cramped modal encouraged
// skipping them. Province/city are dropdowns for the same reason the profile
// form uses them — free text produced non-ASCII values that made EPP fail.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Fingerprint,
  Hash,
  Loader2,
  Mail,
  Map,
  MapPin,
  Phone,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { asciiError, nikError, postalCodeError } from "@/lib/contact";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CitySelect,
  CountryBadge,
  ProvinceSelect,
} from "@/components/WilayahSelect";

type CreateClientResult = {
  client_id: string;
  assignment_id: string;
  is_new_user: boolean;
  invite_sent: boolean;
  email_sent: boolean;
  profile_updated: boolean;
};

type Form = {
  email: string;
  name: string;
  phone_number: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  nik: string;
};

const EMPTY: Form = {
  email: "",
  name: "",
  phone_number: "",
  address: "",
  city: "",
  state: "",
  postal_code: "",
  nik: "",
};

function FieldRow({
  icon: Icon,
  label,
  hint,
  error,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-3.5 text-muted-foreground" />
        {label}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function ClientForm({ basePath }: { basePath: "/agent" | "/reseller" }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  function set<K extends keyof Form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Only shown once the user has tried to submit, so the form does not scold
  // them while they are still filling it in.
  // Same rules as the profile form — both feed the same EPP contact.
  const errors = useMemo(() => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!form.email.includes("@")) e.email = "Email tidak valid";
    if (!form.name.trim()) e.name = "Nama wajib diisi";
    e.name = e.name ?? asciiError(form.name, "Nama");
    e.address = asciiError(form.address, "Alamat");
    e.postal_code = postalCodeError(form.postal_code);
    e.nik = nikError(form.nik);
    for (const k of Object.keys(e) as (keyof Form)[]) {
      if (!e[k]) delete e[k];
    }
    return e;
  }, [form]);
  const shown = touched ? errors : {};

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setErr(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      // One endpoint for reseller and agent alike (RequireResellerOrAgent).
      const res = await api<CreateClientResult>("/api/v1/reseller/clients", {
        method: "POST",
        body: JSON.stringify({ ...form, email: form.email.toLowerCase().trim() }),
      });
      // Report what the server actually did: an existing account gets a
      // heads-up, not a set-password invite, and claiming otherwise sends the
      // reseller chasing an email that was never meant to arrive.
      if (res.is_new_user) {
        toast.success("Klien ditambahkan, email undangan terkirim");
      } else {
        toast.success("Klien ditambahkan — akun sudah terdaftar sebelumnya", {
          description:
            (res.profile_updated
              ? "Data yang Anda isi disimpan ke profil mereka. "
              : "") +
            "Mereka tetap memakai password lama" +
            (res.email_sent ? " dan sudah kami beri tahu lewat email." : "."),
        });
      }
      router.push(`${basePath}/clients`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`${basePath}/clients`}>
              <ArrowLeft />
              Kembali
            </Link>
          </Button>
          <div className="hidden h-5 w-px bg-border sm:block" />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Users className="size-5 text-primary" />
              Tambah Klien
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Email baru akan menerima undangan untuk mengatur password. Email yang
              sudah punya akun langsung terhubung — kolom yang Anda isi akan
              memperbarui profil mereka, yang dikosongkan dibiarkan apa adanya.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identitas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <FieldRow icon={Mail} label="Email *" error={shown.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="klien@example.com"
                autoComplete="off"
                aria-invalid={!!shown.email}
              />
            </FieldRow>

            <FieldRow icon={UserPlus} label="Nama *" error={shown.name}>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Bu Ani Wijaya"
                aria-invalid={!!shown.name}
              />
            </FieldRow>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <FieldRow
              icon={Phone}
              label="Nomor HP"
              hint="Dipakai sebagai kontak domain."
            >
              <Input
                value={form.phone_number}
                onChange={(e) => set("phone_number", e.target.value)}
                placeholder="08123456789"
                inputMode="tel"
              />
            </FieldRow>

            <FieldRow icon={Fingerprint} label="NIK (KTP)" error={shown.nik}>
              <Input
                value={form.nik}
                onChange={(e) => set("nik", e.target.value.replace(/\D/g, "").slice(0, 16))}
                placeholder="16 digit KTP"
                maxLength={16}
                inputMode="numeric"
                className="font-mono tracking-wider"
                aria-invalid={!!shown.nik}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Wajib untuk registrasi domain <code>.id</code> (regulasi Kemenkominfo).
                Untuk TLD lain boleh dikosongkan.
              </p>
            </FieldRow>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alamat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FieldRow icon={MapPin} label="Alamat Jalan" error={shown.address}>
            <Input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Jl. Contoh No. 123, RT 01/RW 02"
              maxLength={255}
              aria-invalid={!!shown.address}
            />
          </FieldRow>

          <FieldRow icon={Map} label="Negara">
            <CountryBadge className="max-w-md" />
          </FieldRow>

          <div className="grid gap-5 sm:grid-cols-2">
            <FieldRow icon={Map} label="Provinsi">
              {/* Changing province resets the city — the city list filters by it. */}
              <ProvinceSelect
                value={form.state}
                onChange={(v) => setForm((f) => ({ ...f, state: v, city: "" }))}
              />
            </FieldRow>

            <FieldRow icon={Building2} label="Kota / Kabupaten">
              <CitySelect
                province={form.state}
                value={form.city}
                onChange={(v) => set("city", v)}
              />
            </FieldRow>
          </div>

          <FieldRow icon={Hash} label="Kode Pos" error={shown.postal_code}>
            <Input
              value={form.postal_code}
              onChange={(e) => set("postal_code", e.target.value)}
              placeholder="12345"
              maxLength={16}
              inputMode="numeric"
              className="max-w-[10rem]"
              aria-invalid={!!shown.postal_code}
            />
          </FieldRow>

          <p className="text-xs text-muted-foreground">
            Alamat dipakai sebagai data kontak saat mendaftarkan domain. Boleh
            dilengkapi nanti lewat halaman detail klien.
          </p>
        </CardContent>
      </Card>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" asChild disabled={saving}>
          <Link href={`${basePath}/clients`}>Batal</Link>
        </Button>
        <Button type="submit" disabled={saving} className="gap-1.5">
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserPlus className="size-4" />
          )}
          Tambah Klien
        </Button>
      </div>
    </form>
  );
}

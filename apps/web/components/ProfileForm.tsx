"use client";

// Shared profile edit form — dipakai di:
//   - /settings/profile        (client)
//   - /reseller/settings       (reseller — di dalam portal layout)
//   - /agent/settings          (agent — di dalam portal layout)
//
// Extract dari settings/profile page. PATCH partial ke /api/v1/auth/me kalau
// ada field yang berubah (dirty tracking). Email read-only di sini — ganti
// email butuh re-verify flow.

import { useEffect, useState } from "react";
import {
  Building2,
  Fingerprint,
  Hash,
  Loader2,
  Mail,
  Map,
  MapPin,
  Phone,
  Save,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { countDigits, isASCIIPrintable, nikError, postalCodeError } from "@/lib/contact";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CitySelect,
  CountryBadge,
  ProvinceSelect,
} from "@/components/WilayahSelect";

type Me = {
  id: string;
  email: string;
  name: string;
  role: string;
  email_verified_at?: string | null;
  phone_number: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  nik: string;
};

const EDITABLE = [
  "name",
  "phone_number",
  "address",
  "city",
  "state",
  "postal_code",
  "nik",
] as const;
type EditableKey = (typeof EDITABLE)[number];

function fieldErrors(f: Record<EditableKey, string>): Partial<Record<EditableKey, string>> {
  const e: Partial<Record<EditableKey, string>> = {};
  if (f.name && !isASCIIPrintable(f.name)) {
    e.name = "Nama hanya boleh huruf/angka standar (tanpa aksen atau emoji)";
  }
  if (f.phone_number) {
    const d = countDigits(f.phone_number);
    if (d < 7 || d > 15) e.phone_number = "Nomor HP harus 7-15 digit (contoh: +62 812 3456 7890)";
  }
  if (f.address && !isASCIIPrintable(f.address)) {
    e.address = "Alamat hanya boleh karakter ASCII (tanpa aksen atau emoji)";
  }
  if (f.city && !isASCIIPrintable(f.city)) {
    e.city = "Nama kota hanya boleh karakter ASCII";
  }
  if (f.state && !isASCIIPrintable(f.state)) {
    e.state = "Nama provinsi hanya boleh karakter ASCII";
  }
  const postal = postalCodeError(f.postal_code);
  if (postal) e.postal_code = postal;
  const nik = nikError(f.nik);
  if (nik) e.nik = nik;
  return e;
}

export function ProfileForm({
  title = "Profil Akun",
  description = "Data kontak & alamat dipakai sebagai WHOIS contact + invoice untuk domain baru. Perubahan di sini tidak otomatis ter-update ke domain yang sudah aktif.",
}: {
  title?: string;
  description?: string;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [form, setForm] = useState<Record<EditableKey, string>>({
    name: "",
    phone_number: "",
    address: "",
    city: "",
    state: "",
    postal_code: "",
    nik: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Me>("/api/v1/auth/me")
      .then((u) => {
        setMe(u);
        setForm({
          name: u.name ?? "",
          phone_number: u.phone_number ?? "",
          address: u.address ?? "",
          city: u.city ?? "",
          state: u.state ?? "",
          postal_code: u.postal_code ?? "",
          nik: u.nik ?? "",
        });
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const dirty = me
    ? EDITABLE.some((k) => form[k] !== ((me as unknown as Record<string, string>)[k] ?? ""))
    : false;

  const errors = fieldErrors(form);
  const hasErrors = Object.keys(errors).length > 0;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!me || !dirty || hasErrors) return;
    setSaving(true);
    try {
      const patch: Partial<Record<EditableKey, string>> = {};
      EDITABLE.forEach((k) => {
        if (form[k] !== ((me as unknown as Record<string, string>)[k] ?? "")) {
          patch[k] = form[k];
        }
      });
      const updated = await api<Me>("/api/v1/auth/me", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setMe(updated);
      toast.success("Profil tersimpan");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Memuat profil…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <form onSubmit={onSave}>
        <Card>
          <CardHeader>
            <CardTitle>Data Akun</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <FieldRow icon={Mail} label="Email">
              <Input value={me?.email ?? ""} readOnly disabled className="max-w-md" />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Email tidak bisa diubah dari halaman ini.
              </p>
            </FieldRow>

            <FieldRow icon={UserIcon} label="Nama Lengkap" error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nama sesuai KTP"
                maxLength={128}
                className="max-w-md"
                aria-invalid={!!errors.name}
              />
            </FieldRow>

            <FieldRow icon={Phone} label="Nomor HP / WhatsApp" error={errors.phone_number}>
              <Input
                value={form.phone_number}
                onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
                placeholder="+62812xxxxxxx"
                maxLength={32}
                inputMode="tel"
                className="max-w-md"
                aria-invalid={!!errors.phone_number}
              />
            </FieldRow>

            <FieldRow icon={Fingerprint} label="NIK (KTP)" error={errors.nik}>
              <Input
                value={form.nik}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nik: e.target.value.replace(/\D/g, "").slice(0, 16) }))
                }
                placeholder="16 digit KTP"
                maxLength={16}
                inputMode="numeric"
                className="max-w-md tracking-wider font-mono"
                aria-invalid={!!errors.nik}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Wajib untuk registrasi domain <code>.id</code> (regulasi Kemenkominfo).
                Untuk TLD lain (.com, .net, dst.) boleh dikosongkan.
              </p>
            </FieldRow>
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Alamat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <FieldRow icon={MapPin} label="Alamat Jalan" error={errors.address}>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Jl. Contoh No. 123, RT 01/RW 02"
                maxLength={255}
                aria-invalid={!!errors.address}
              />
            </FieldRow>

            <FieldRow icon={Map} label="Negara">
              <CountryBadge className="max-w-md" />
            </FieldRow>

            <div className="grid gap-5 sm:grid-cols-2">
              <FieldRow icon={Map} label="Provinsi" error={errors.state}>
                {/* Ganti provinsi → reset city (dropdown kota filter by provinsi). */}
                <ProvinceSelect
                  value={form.state}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, state: v, city: "" }))
                  }
                />
              </FieldRow>

              <FieldRow icon={Building2} label="Kota / Kabupaten" error={errors.city}>
                <CitySelect
                  province={form.state}
                  value={form.city}
                  onChange={(v) => setForm((f) => ({ ...f, city: v }))}
                />
              </FieldRow>
            </div>

            <FieldRow icon={Hash} label="Kode Pos" error={errors.postal_code}>
              <Input
                value={form.postal_code}
                onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                placeholder="12345"
                maxLength={16}
                inputMode="numeric"
                className="max-w-[10rem]"
                aria-invalid={!!errors.postal_code}
              />
            </FieldRow>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-end gap-3">
          {hasErrors ? (
            <span className="text-xs text-destructive">
              Perbaiki field yang bertanda merah sebelum menyimpan
            </span>
          ) : dirty ? (
            <span className="text-xs text-muted-foreground">
              Ada perubahan yang belum disimpan
            </span>
          ) : null}
          <Button type="submit" disabled={!dirty || saving || hasErrors} className="gap-2">
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Menyimpan…
              </>
            ) : (
              <>
                <Save className="size-4" />
                Simpan
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FieldRow({
  icon: Icon,
  label,
  error,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
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
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

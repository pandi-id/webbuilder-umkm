"use client";

// Client detail — dipakai di /reseller/clients/[id] dan /agent/clients/[id].
// 2 tab: Profil (edit) + Domain (purchases yang di-trigger untuk klien ini).
//
// Endpoint sama untuk kedua role (backend /reseller/clients dan /agent/clients
// keduanya route ke handler yang sama + ownership check via assignment).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  ExternalLink,
  Globe2,
  Loader2,
  Mail,
  Save,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CitySelect,
  CountryBadge,
  ProvinceSelect,
} from "@/components/WilayahSelect";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Client = {
  id: string;
  email: string;
  name: string;
  phone_number?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  nik?: string;
  role?: string;
};

type Purchase = {
  job_id: string;
  domain: string;
  status: string;
  kind: string;
  payment_url?: string;
  years?: number;
  expires_at?: string;
  created_at?: string;
  client_id?: string;
  client_name?: string;
  client_email?: string;
};

const STATUS_LABELS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  active: { label: "Aktif", variant: "success" },
  pending_payment: { label: "Menunggu bayar", variant: "warning" },
  pending_document: { label: "Perlu dokumen", variant: "warning" },
  pending_provisioning: { label: "Provisioning", variant: "warning" },
  pending_approval: { label: "Menunggu approval", variant: "warning" },
  failed: { label: "Gagal", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  cancelled: { label: "Dibatalkan", variant: "secondary" },
};

// ClientDetail — komponen utama. basePath dipakai back-link + purchase list
// endpoint (agent → /agent/*, reseller → /reseller/*).
export function ClientDetail({
  clientID,
  basePath,
  apiPrefix,
}: {
  clientID: string;
  // Prefix path frontend, mis. "/reseller/clients" atau "/agent/clients".
  basePath: string;
  // Prefix backend, mis. "reseller" atau "agent". Dipakai untuk GET client
  // + GET purchases. PATCH endpoint pakai reseller path (handler sama untuk
  // kedua role) supaya kita tidak duplikasi state di 2 route.
  apiPrefix: "reseller" | "agent";
}) {
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"profile" | "domains">("profile");

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const c = await api<Client>(`/api/v1/${apiPrefix}/clients/${clientID}`);
      setClient(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientID]);

  if (loading && !client) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Memuat data klien…
      </div>
    );
  }

  if (err && !client) {
    return (
      <div className="space-y-4">
        <BackLink basePath={basePath} />
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
          <span>{err}</span>
        </div>
      </div>
    );
  }

  if (!client) return null;

  return (
    <div className="space-y-6">
      <BackLink basePath={basePath} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <User className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight truncate">
              {client.name || client.email}
            </h1>
          </div>
          <p className="flex items-center ps-1 gap-1.5 text-sm text-muted-foreground">
            <Mail className="size-3.5" />
            <span className="font-mono text-xs">{client.email}</span>
          </p>
        </div>
        <Button asChild className="gap-1.5" size="sm">
          <Link href={`/sites/new-with-domain?for_client=${clientID}`}>
            <Globe2 className="size-4" />
            Beli Domain untuk Klien
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full justify-start bg-muted/40">
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="domains">Domain</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <ProfileTab
            client={client}
            onSaved={(updated) => setClient(updated)}
          />
        </TabsContent>
        <TabsContent value="domains" className="mt-4">
          <DomainsTab
            clientID={clientID}
            apiPrefix={apiPrefix}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackLink({ basePath }: { basePath: string }) {
  return (
    <Button variant="ghost" size="sm" asChild className="gap-1.5">
      <Link href={basePath}>
        <ArrowLeft className="size-4" />
        Kembali ke daftar klien
      </Link>
    </Button>
  );
}

// -------- Tab 1: Profil (edit) --------

function ProfileTab({
  client,
  onSaved,
}: {
  client: Client;
  onSaved: (c: Client) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: client.name ?? "",
    phone_number: client.phone_number ?? "",
    address: client.address ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    postal_code: client.postal_code ?? "",
    nik: client.nik ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: client.name ?? "",
      phone_number: client.phone_number ?? "",
      address: client.address ?? "",
      city: client.city ?? "",
      state: client.state ?? "",
      postal_code: client.postal_code ?? "",
      nik: client.nik ?? "",
    });
  }, [client]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const dirty = useMemo(() => {
    return (
      form.name !== (client.name ?? "") ||
      form.phone_number !== (client.phone_number ?? "") ||
      form.address !== (client.address ?? "") ||
      form.city !== (client.city ?? "") ||
      form.state !== (client.state ?? "") ||
      form.postal_code !== (client.postal_code ?? "") ||
      form.nik !== (client.nik ?? "")
    );
  }, [form, client]);

  async function submit() {
    setErr(null);
    if (!form.name.trim()) {
      setErr("Nama wajib diisi");
      return;
    }
    if (form.nik && !/^\d{16}$/.test(form.nik)) {
      setErr("NIK harus tepat 16 digit angka");
      return;
    }
    setSaving(true);
    try {
      // Endpoint sama untuk reseller & agent (route handler shared).
      const updated = await api<Client>(`/api/v1/reseller/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      toast.success("Profil klien diperbarui");
      onSaved(updated);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div>
          <h3 className="text-base font-semibold">Data Kontak</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Dipakai untuk WHOIS + invoice registrasi domain. Provinsi & NIK
            wajib untuk TLD .id per regulasi Kemenkominfo.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cd-name">Nama *</Label>
            <Input
              id="cd-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-email">Email</Label>
            <Input
              id="cd-email"
              value={client.email}
              disabled
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Email tidak bisa diubah dari sini.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cd-phone">Nomor HP</Label>
            <Input
              id="cd-phone"
              type="tel"
              value={form.phone_number}
              onChange={(e) => set("phone_number", e.target.value)}
              placeholder="+62812xxxxxxx"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-nik">
              NIK (KTP){" "}
              <span className="text-[10px] font-normal text-muted-foreground">
                — wajib untuk .id
              </span>
            </Label>
            <Input
              id="cd-nik"
              value={form.nik}
              onChange={(e) =>
                set("nik", e.target.value.replace(/\D/g, "").slice(0, 16))
              }
              placeholder="16 digit NIK"
              inputMode="numeric"
              maxLength={16}
              className="font-mono"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cd-address">Alamat</Label>
          <Textarea
            id="cd-address"
            rows={2}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Jl. Contoh No. 10..."
          />
        </div>

        <div className="space-y-1.5">
          <Label>Negara</Label>
          <CountryBadge className="max-w-md" />
        </div>

        {/* Dropdowns, not free text: EPP contact:create rejects non-ASCII and
            typo'd region names with "Transaction rolled back". */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>
              Provinsi{" "}
              <span className="text-[10px] font-normal text-muted-foreground">*</span>
            </Label>
            <ProvinceSelect
              value={form.state}
              onChange={(v) => setForm((f) => ({ ...f, state: v, city: "" }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kota / Kabupaten</Label>
            <CitySelect
              province={form.state}
              value={form.city}
              onChange={(v) => set("city", v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-postal">Kode Pos</Label>
            <Input
              id="cd-postal"
              value={form.postal_code}
              onChange={(e) => set("postal_code", e.target.value)}
              placeholder="10110"
              maxLength={16}
              inputMode="numeric"
            />
          </div>
        </div>

        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {err}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          {dirty && (
            <span className="mr-auto text-xs text-muted-foreground">
              Ada perubahan belum disimpan.
            </span>
          )}
          <Button
            onClick={submit}
            disabled={!dirty || saving}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Simpan Perubahan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// -------- Tab 2: Domain --------

function DomainsTab({
  clientID,
  apiPrefix,
}: {
  clientID: string;
  apiPrefix: "reseller" | "agent";
}) {
  const [items, setItems] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    // Endpoint kembalikan semua purchase caller — filter client-side by
    // client_id. Fine untuk MVP (max 200 rows).
    api<Purchase[]>(`/api/v1/${apiPrefix}/purchases?limit=200`)
      .then((res) => {
        const filtered = (res ?? []).filter((p) => p.client_id === clientID);
        setItems(filtered);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [clientID, apiPrefix]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Memuat daftar domain…
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0 translate-y-0.5" />
        <span>{err}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
          <Globe2 className="size-8 opacity-30" />
          <p className="text-sm font-medium">Belum ada domain</p>
          <p className="max-w-md text-xs">
            Klik <b>Beli Domain untuk Klien</b> di atas untuk mulai pembelian
            atas nama klien ini.
          </p>
          <Button size="sm" asChild className="mt-2 gap-1.5">
            <Link href={`/sites/new-with-domain?for_client=${clientID}`}>
              <Globe2 className="size-3.5" />
              Beli Domain
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((p) => (
        <DomainRow key={p.job_id} purchase={p} />
      ))}
    </div>
  );
}

function DomainRow({ purchase }: { purchase: Purchase }) {
  const status = STATUS_LABELS[purchase.status] ?? {
    label: purchase.status,
    variant: "secondary" as const,
  };
  const isPending = purchase.status.startsWith("pending_") || purchase.status === "failed";
  const detailHref = isPending
    ? `/sites/pending/${purchase.job_id}`
    : `/agent/domains/${purchase.domain}`;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe2 className="size-4 text-primary" />
            <p className="truncate font-mono text-sm font-semibold">
              {purchase.domain}
            </p>
            <Badge variant={status.variant} className="text-[10px]">
              {status.label}
            </Badge>
            {purchase.kind && purchase.kind !== "register" && (
              <Badge variant="secondary" className="text-[10px]">
                {purchase.kind}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {purchase.years ? <span>{purchase.years} tahun</span> : null}
            {purchase.expires_at && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                expire {formatDate(purchase.expires_at)}
              </span>
            )}
            {purchase.created_at && (
              <span>dibeli {formatDate(purchase.created_at)}</span>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" asChild className="gap-1.5">
          <Link href={detailHref}>
            {isPending ? "Lanjut proses" : "Kelola"}
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      </CardContent>
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

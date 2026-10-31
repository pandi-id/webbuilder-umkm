"use client";

// Reseller > Klien — clients assigned directly to this reseller.

import { ClientsList } from "@/components/clients/ClientsList";

export default function ResellerClientsPage() {
  return (
    <ClientsList
      basePath="/reseller"
      title="Klien"
      description="Daftarkan klien baru — mereka akan terima email undangan untuk aktifkan akun."
    />
  );
}

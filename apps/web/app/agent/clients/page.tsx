"use client";

// Agent > Klien — only the clients this agent manages, not the parent
// reseller's whole book.

import { ClientsList } from "@/components/clients/ClientsList";

export default function AgentClientsPage() {
  return (
    <ClientsList
      basePath="/agent"
      title="Klien saya"
      description="Klien yang Anda daftarkan. Reseller induk melihat daftar ini juga."
    />
  );
}

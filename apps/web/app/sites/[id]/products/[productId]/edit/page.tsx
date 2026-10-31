"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { ProductForm, type Product } from "../../ProductForm";

export default function EditProductPage() {
  const params = useParams<{ id: string; productId: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Product>(`/api/v1/products/${params.productId}`)
      .then(setProduct)
      .catch((e) => setErr((e as Error).message));
  }, [params.productId]);

  if (err) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" />
        <span>
          <span className="font-medium">Gagal memuat produk:</span> {err}
        </span>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Memuat produk…
      </div>
    );
  }

  return <ProductForm siteId={params.id} product={product} />;
}

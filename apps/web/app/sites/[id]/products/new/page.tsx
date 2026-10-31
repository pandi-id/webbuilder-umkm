"use client";

import { useParams } from "next/navigation";
import { ProductForm } from "../ProductForm";

export default function NewProductPage() {
  const params = useParams<{ id: string }>();
  return <ProductForm siteId={params.id} product={null} />;
}

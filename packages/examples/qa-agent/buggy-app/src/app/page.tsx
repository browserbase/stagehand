"use client";

import { useEffect } from "react";
import { products } from "@/lib/products";
import ProductCard from "@/components/ProductCard";

export default function HomePage() {
  // BUG-07: Console error — fetches non-existent analytics endpoint
  useEffect(() => {
    fetch("/api/analytics").catch(() => {});
  }, []);

  return (
    <div>
      {/* BUG-06: Typo — "Prodcuts" instead of "Products" */}
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Our Prodcuts</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Product } from "@/lib/products";
import { useCart } from "@/lib/cart-store";

export default function ProductCard({ product }: { product: Product }) {
  const { addToCart } = useCart();

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <Link href={`/product/${product.id}`}>
        {/* BUG-09: Images have empty alt text — no descriptive alt */}
        <img src={product.image} alt="" className="w-full h-48 object-cover" />
      </Link>
      <div className="p-4">
        <Link href={`/product/${product.id}`}>
          <h3 className="font-semibold text-lg text-gray-900 hover:text-blue-600">
            {product.name}
          </h3>
        </Link>
        <p className="text-gray-500 text-sm mt-1 line-clamp-2">{product.description}</p>
        <div className="flex items-center justify-between mt-4">
          <span className="text-xl font-bold text-gray-900">${product.price.toFixed(2)}</span>
          {product.inStock ? (
            <button
              onClick={() => addToCart(product)}
              // BUG-08: Product #3 has disabled button with no visual indicator
              disabled={product.id === 3}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add to Cart
            </button>
          ) : (
            <span className="text-red-500 font-medium">Out of Stock</span>
          )}
        </div>
      </div>
    </div>
  );
}

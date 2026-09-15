"use client";

import { useParams } from "next/navigation";
import { products } from "@/lib/products";
import { useCart } from "@/lib/cart-store";
import Link from "next/link";

export default function ProductPage() {
  const params = useParams();
  const { addToCart } = useCart();
  const product = products.find((p) => p.id === Number(params.id));

  if (!product) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-gray-900">Product Not Found</h1>
        <Link href="/" className="text-blue-600 hover:underline mt-4 inline-block">
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="md:flex">
        <div className="md:w-1/2">
          <img src={product.image} alt="" className="w-full h-96 object-cover" />
        </div>
        <div className="md:w-1/2 p-8 relative">
          <span className="text-sm text-blue-600 font-medium">{product.category}</span>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">{product.name}</h1>

          {/* BUG-10: Description has position absolute, overlaps button on narrow viewports */}
          <p className="text-gray-600 mt-4 absolute md:relative" style={{ top: "200px" }}>
            {product.description}
          </p>

          {/* BUG-02: Price is multiplied by 10 (displayed as 10x actual) */}
          <div className="mt-6">
            <span className="text-4xl font-bold text-gray-900">
              ${(product.price * 10).toFixed(2)}
            </span>
          </div>

          <div className="mt-8 flex gap-4">
            {product.inStock ? (
              <button
                onClick={() => addToCart(product)}
                className="bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                Add to Cart
              </button>
            ) : (
              <span className="text-red-500 font-semibold text-lg">Out of Stock</span>
            )}
            <Link
              href="/"
              className="border border-gray-300 px-8 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
            >
              Back to Shop
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

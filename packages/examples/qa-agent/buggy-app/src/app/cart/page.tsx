"use client";

import { useCart } from "@/lib/cart-store";
import CartSummary from "@/components/CartSummary";
import Link from "next/link";

export default function CartPage() {
  const { items, removeFromCart, updateQuantity } = useCart();

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-gray-900">Your Cart is Empty</h1>
        <p className="text-gray-500 mt-2">Add some products to get started!</p>
        <Link href="/" className="text-blue-600 hover:underline mt-4 inline-block">
          Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Shopping Cart</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => (
            <div
              key={item.product.id}
              className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-4"
            >
              <img src={item.product.image} alt="" className="w-20 h-20 object-cover rounded" />
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">{item.product.name}</h3>
                <p className="text-gray-500 text-sm">${item.product.price.toFixed(2)} each</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => removeFromCart(item.product.id)}
                  className="w-8 h-8 border rounded flex items-center justify-center hover:bg-gray-50"
                >
                  -
                </button>
                {/* BUG-05 surfaces here: quantity can show 0 */}
                <span className="w-8 text-center font-medium">{item.quantity}</span>
                <button
                  onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                  className="w-8 h-8 border rounded flex items-center justify-center hover:bg-gray-50"
                >
                  +
                </button>
              </div>
              <span className="font-bold text-gray-900 w-24 text-right">
                ${(item.product.price * item.quantity).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <CartSummary />
          <Link
            href="/checkout"
            className="mt-4 block w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-center"
          >
            Proceed to Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}

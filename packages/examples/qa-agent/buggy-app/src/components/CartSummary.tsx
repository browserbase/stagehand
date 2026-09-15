"use client";

import { useCart } from "@/lib/cart-store";

export default function CartSummary() {
  const { items } = useCart();

  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  // BUG-11: Tax is 80% instead of 8% (0.8 vs 0.08)
  const tax = subtotal * 0.8;

  // BUG-12: Total doesn't include tax — just shows subtotal
  const total = subtotal;

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Order Summary</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span>${tax.toFixed(2)}</span>
        </div>
        <div className="border-t pt-2 mt-2 flex justify-between font-bold text-lg">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

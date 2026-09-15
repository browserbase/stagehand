"use client";

import CheckoutForm from "@/components/CheckoutForm";
import CartSummary from "@/components/CartSummary";

export default function CheckoutPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm p-6">
          <CheckoutForm />
        </div>
        <div>
          <CartSummary />
        </div>
      </div>
    </div>
  );
}

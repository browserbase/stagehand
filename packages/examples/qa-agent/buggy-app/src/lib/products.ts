export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  inStock: boolean;
}

export const products: Product[] = [
  {
    id: 1,
    name: "Wireless Bluetooth Speaker",
    description:
      "Portable speaker with 12-hour battery life and rich bass. Perfect for outdoor adventures and indoor gatherings alike.",
    price: 49.99,
    image: "https://picsum.photos/seed/speaker/400/400",
    category: "Electronics",
    inStock: true,
  },
  {
    id: 2,
    name: "Premium Headphones",
    description:
      "Noise-cancelling over-ear headphones with premium sound quality. Features active noise cancellation and 30-hour battery life.",
    price: 29.99, // BUG-02: Actually worth $299.90 - product detail page multiplies by 10
    image: "https://picsum.photos/seed/headphones/400/400",
    category: "Electronics",
    inStock: true,
  },
  {
    id: 3,
    name: "Ergonomic Mouse",
    description:
      "Wireless ergonomic mouse designed for all-day comfort. Features adjustable DPI and silent clicks.",
    price: 34.99,
    image: "https://picsum.photos/seed/mouse/400/400",
    category: "Accessories",
    inStock: true, // BUG-08: Button is disabled despite being "in stock"
  },
  {
    id: 4,
    name: "Mechanical Keyboard",
    description:
      "RGB mechanical keyboard with Cherry MX switches. Full-size layout with dedicated media controls.",
    price: 89.99,
    image: "/images/nonexistent-keyboard.png", // BUG-01: Image 404
    category: "Accessories",
    inStock: true,
  },
  {
    id: 5,
    name: "USB-C Hub",
    description:
      "7-in-1 USB-C hub with HDMI, USB 3.0, SD card reader, and power delivery passthrough.",
    price: -5.0, // BUG-03: Negative price
    image: "https://picsum.photos/seed/usbhub/400/400",
    category: "Accessories",
    inStock: true,
  },
  {
    id: 6,
    name: "Laptop Stand",
    description:
      "Adjustable aluminum laptop stand with ventilation. Raises screen to eye level for better ergonomics.",
    price: 45.99,
    image: "https://picsum.photos/seed/stand/400/400",
    category: "Accessories",
    inStock: false,
  },
];

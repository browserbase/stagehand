import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="bg-white rounded-lg shadow-sm p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">About BugMart</h1>

      {/* BUG-18: Heading jumps from h1 to h4, skipping h2 and h3 */}
      <h4 className="text-xl font-semibold text-gray-800 mb-4">Our Mission</h4>

      {/* BUG-16: Light gray text on white background — poor contrast */}
      <p style={{ color: "#cccccc" }} className="mb-6">
        BugMart was founded in 2024 with a simple mission: to provide high-quality electronics at
        affordable prices. We believe that everyone deserves access to the best technology without
        breaking the bank. Our team of experts carefully curates each product in our catalog to
        ensure it meets our standards for quality, performance, and value.
      </p>

      <h4 className="text-xl font-semibold text-gray-800 mb-4">Our Team</h4>
      <p className="text-gray-600 mb-6">
        We are a team of passionate tech enthusiasts who love helping people find the perfect
        gadgets. With decades of combined experience in electronics retail, we know what makes a
        great product.
      </p>

      <h4 className="text-xl font-semibold text-gray-800 mb-4">Get in Touch</h4>
      <p className="text-gray-600 mb-4">
        Have questions or feedback? We would love to hear from you!
      </p>

      {/* BUG-17: Contact Us link goes to /contact which doesn't exist */}
      <Link
        href="/contact"
        className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
      >
        Contact Us
      </Link>
    </div>
  );
}

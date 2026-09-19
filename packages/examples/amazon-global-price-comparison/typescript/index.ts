// Amazon Global Price Comparison - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// Schema for a single product with structured extraction fields
const ProductSchema = z.object({
  name: z.string().describe("The full product title/name"),
  price: z
    .string()
    .describe(
      "The product price including currency symbol (e.g., '$29.99', '29,99 EUR', '29.99 GBP'). If no price is visible, return 'N/A'",
    ),
  rating: z.string().describe("The star rating (e.g., '4.5 out of 5 stars')"),
  reviews_count: z.string().describe("The number of customer reviews (e.g., '1,234')"),
  product_url: z.string().url().describe("The absolute href URL of the product detail page"),
});

// Schema for extracting multiple products from search results
const ProductsSchema = z.object({
  products: z.array(ProductSchema).describe("Array of products from search results"),
});

type Product = z.infer<typeof ProductSchema>;

// Country configuration with geolocation proxy settings
// Each country routes traffic through its geographic location to see local pricing
interface CountryConfig {
  name: string;
  code: string;
  domain: string;
  city?: string;
  currency: string;
}

// Supported countries for price comparison
// Add or remove countries as needed - see https://docs.browserbase.com/features/proxies for available geolocations
const COUNTRIES: CountryConfig[] = [
  { name: "United States", code: "US", domain: "www.amazon.com", currency: "USD" },
  {
    name: "United Kingdom",
    code: "GB",
    domain: "www.amazon.co.uk",
    city: "LONDON",
    currency: "GBP",
  },
  { name: "Germany", code: "DE", domain: "www.amazon.de", city: "BERLIN", currency: "EUR" },
  { name: "France", code: "FR", domain: "www.amazon.fr", city: "PARIS", currency: "EUR" },
  { name: "Italy", code: "IT", domain: "www.amazon.it", city: "ROME", currency: "EUR" },
  { name: "Spain", code: "ES", domain: "www.amazon.es", city: "MADRID", currency: "EUR" },
];

// Results structure for each country
interface CountryResult {
  country: string;
  countryCode: string;
  currency: string;
  products: Product[];
  error?: string;
}

async function closeSession(
  stagehand: Stagehand,
  browser: Awaited<ReturnType<typeof browserbase.launch>>,
) {
  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
}

/**
 * Fetches products from Amazon for a specific country using geolocation proxy
 * Uses Browserbase's managed proxy infrastructure to route traffic through the target country
 * This ensures Amazon shows location-specific pricing and availability
 */
async function getProductsForCountry(
  searchQuery: string,
  country: CountryConfig,
  resultsCount: number = 3,
): Promise<CountryResult> {
  console.log(`\n=== Searching Amazon for "${searchQuery}" in ${country.name} ===`);

  // Build geolocation config for proxy routing
  const geolocation: { country: string; city?: string } = {
    country: country.code,
  };
  if (country.city) {
    geolocation.city = country.city;
  }

  // Initialize Stagehand with geolocation proxy configuration
  // This ensures all browser traffic routes through the specified geographic location
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    proxies: [
      {
        type: "browserbase", // Use Browserbase's managed proxy infrastructure for reliable geolocation routing
        geolocation,
      },
    ],
  });
  const stagehand = await Stagehand.create({ browser: browser, logging: { level: "error" } });

  try {
    console.log(`Initializing browser session with ${country.name} proxy...`);

    let page = (await browser.context.pages())[0];

    // Alternative: Skip the search bar and go straight to results by building the search URL.
    // Uncomment below to use direct navigation instead of stagehand.act() typing + clicking.
    // const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}`;
    // console.log(`Navigating to: ${searchUrl}`);
    // await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Use the matching regional storefront, then let Stagehand perform the
    // semantic search interaction rather than coupling the template to the DOM.
    const origin = `https://${country.domain}`;
    console.log(`[${country.name}] Navigating to ${origin}...`);
    await page.goto(origin, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    let semanticSearchSucceeded = false;
    try {
      const typed = await stagehand.act(`Type "${searchQuery}" into the search bar`);
      const submitted = await stagehand.act("Click the search button");
      semanticSearchSucceeded = typed.data.success && submitted.data.success;
    } catch (error) {
      console.warn(
        `[${country.name}] Semantic search failed; checking results before fallback`,
        error,
      );
    }
    page = (await browser.context.activePage()) ?? page;
    const resultsReady = semanticSearchSucceeded
      ? await page
          .waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 })
          .catch(() => false)
      : false;
    if (!resultsReady) {
      const searchUrl = `${origin}/s?k=${encodeURIComponent(searchQuery)}`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 15000 });
    }

    console.log(`[${country.name}] Extracting top ${resultsCount} products...`);
    const { data: extractionResult } = await stagehand.extract(
      `Extract the first ${resultsCount} product search results from this Amazon page. For each product, extract the full title, displayed price with currency symbol (or "N/A"), star rating, review count, and absolute product-page href. Each URL must be a real Amazon link containing /dp/. Only extract actual product listings.`,
      ProductsSchema,
    );

    // Clean up products - ensure price is never null and URLs are absolute
    const cleanedProducts = extractionResult.products.map((p) => ({
      ...p,
      price: p.price || "N/A",
      product_url: p.product_url?.startsWith("http")
        ? p.product_url
        : p.product_url?.startsWith("/")
          ? `${origin}${p.product_url}`
          : p.product_url || "N/A",
    }));

    console.log(`Found ${cleanedProducts.length} products in ${country.name}`);

    await closeSession(stagehand, browser);

    return {
      country: country.name,
      countryCode: country.code,
      currency: country.currency,
      products: cleanedProducts.slice(0, resultsCount),
    };
  } catch (error) {
    console.error(`Error fetching products from ${country.name}:`, error);
    await closeSession(stagehand, browser);

    return {
      country: country.name,
      countryCode: country.code,
      currency: country.currency,
      products: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Displays results in a formatted comparison table
 * Shows product name, price, rating, and review count for each country
 */
function displayComparisonTable(results: CountryResult[]) {
  console.log("\n" + "=".repeat(100));
  console.log("PRICE COMPARISON ACROSS COUNTRIES");
  console.log("=".repeat(100));

  // Find the first successful result to get product count
  const successfulResult = results.find((r) => r.products.length > 0);
  if (!successfulResult) {
    console.log("No products found in any country.");
    return;
  }

  // Display results for each product position
  const maxProducts = Math.max(...results.map((r) => r.products.length));

  for (let i = 0; i < maxProducts; i++) {
    console.log(`\n--- Product ${i + 1} ---`);

    // Find the first available product name for this position
    const productName = results.find((r) => r.products[i])?.products[i]?.name;
    if (productName) {
      const truncatedName =
        productName.length > 80 ? productName.slice(0, 77) + "..." : productName;
      console.log(`Product: ${truncatedName}`);
    }

    console.log("\nPrices by Country:");
    console.log("-".repeat(70));

    for (const result of results) {
      const countryPad = result.country.padEnd(20);
      if (result.error) {
        console.log(`  ${countryPad} | Error: ${result.error}`);
      } else if (result.products[i]) {
        const product = result.products[i];
        const price = product.price || "N/A";
        const pricePad = price.padEnd(18);
        const ratingShort = product.rating?.split(" out")[0] || "N/A";
        const ratingPad = ratingShort.padEnd(6);
        const reviews = product.reviews_count || "N/A";
        console.log(`  ${countryPad} | ${pricePad} | ${ratingPad} stars | ${reviews} reviews`);
      } else {
        console.log(`  ${countryPad} | Not available in this country`);
      }
    }
  }

  console.log("\n" + "=".repeat(100));
}

async function main() {
  // Configure search parameters
  const searchQuery = "iPhone 15 Pro Max 256GB";
  const resultsCount = 3;
  const countryLimit = Number.parseInt(process.env.MAX_COUNTRIES ?? String(COUNTRIES.length), 10);
  if (!Number.isInteger(countryLimit) || countryLimit < 1) {
    throw new Error("MAX_COUNTRIES must be a positive integer");
  }
  const selectedCountries = COUNTRIES.slice(0, countryLimit);

  console.log("=".repeat(60));
  console.log("AMAZON PRICE COMPARISON - GEOLOCATION PROXY DEMO");
  console.log("=".repeat(60));
  console.log(`Search Query: ${searchQuery}`);
  console.log(`Results per country: ${resultsCount}`);
  console.log(`Countries: ${selectedCountries.map((c) => c.code).join(", ")}`);
  console.log("=".repeat(60));

  // Process all countries concurrently for faster execution
  // Each country uses its own browser session, so they can run in parallel
  console.log(`\nFetching prices from ${selectedCountries.length} countries concurrently...`);

  const results = await Promise.all(
    selectedCountries.map((country) => getProductsForCountry(searchQuery, country, resultsCount)),
  );

  // Display formatted comparison table
  displayComparisonTable(results);

  // Output JSON results for programmatic use
  console.log("\n--- JSON OUTPUT ---");
  console.log(JSON.stringify(results, null, 2));

  console.log("\n=== Price comparison completed ===");
}

main().catch((err) => {
  console.error("Application error:", err);
  console.error("\nCommon issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error(
    "  - Verify geolocation proxy locations are valid (see https://docs.browserbase.com/features/proxies)",
  );
  console.error("  - Ensure you have sufficient Browserbase credits");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});

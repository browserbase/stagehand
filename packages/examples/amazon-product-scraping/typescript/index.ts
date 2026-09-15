// Stagehand + Browserbase: Amazon Product Scraping - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// ============= CONFIGURATION =============
// Update this value to search for different products
const SEARCH_QUERY = "Seiko 5";
// =========================================

// Schema for a single product with structured extraction fields
const ProductSchema = z.object({
  name: z.string().describe("The full product title/name"),
  price: z.string().describe("The product price including currency symbol (e.g., '$29.99')"),
  rating: z.string().describe("The star rating (e.g., '4.5 out of 5 stars')"),
  reviews_count: z.string().describe("The number of customer reviews (e.g., '1,234')"),
  product_url: z.string().url().describe("The absolute href of the Amazon product detail page"),
});

// Schema for extracting multiple products from search results
const ProductsSchema = z.object({
  products: z.array(ProductSchema).describe("Array of the first 3 products from search results"),
});

async function main(): Promise<void> {
  console.log("Starting Amazon Product Scraping...");

  // Initialize Stagehand with Browserbase for cloud-based browser automation.
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "google/gemini-2.5-flash" },
    logging: { level: "info" },
  });

  try {
    // Initialize browser session to start automation.

    console.log("Stagehand initialized successfully!");
    let page = (await browser.context.pages())[0];

    // Alternative: skip the search bar and go straight to results by building the search URL.
    // Uncomment below to use direct navigation instead of stagehand.act() typing + clicking.
    // // Build search URL
    // const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");
    // const searchUrl = `https://www.amazon.com/s?k=${encodedQuery}`;

    // console.log(`Navigating to: ${searchUrl}`);
    // await page.goto(searchUrl, {
    //   waitUntil: "domcontentloaded",
    // });

    // Navigate to Amazon and use Stagehand's semantic browser primitives for
    // the search workflow so the template remains resilient to UI changes.
    console.log("Navigating to Amazon...");
    await page.goto("https://www.amazon.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    console.log(`Searching for: ${SEARCH_QUERY}`);
    const typed = await stagehand.act(`Type "${SEARCH_QUERY}" into the search bar`);
    const submitted = await stagehand.act("Click the search button");
    if (!typed.data.success || !submitted.data.success) {
      throw new Error(typed.data.message || submitted.data.message || "Amazon search failed");
    }
    page = (await browser.context.activePage()) ?? page;
    const resultsReady = await page
      .waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 })
      .catch(() => false);
    if (!resultsReady) {
      // Amazon occasionally replaces the document during the semantic submit,
      // invalidating the result frame. Fall back only after the readiness check
      // proves the act-driven navigation did not produce a results page.
      const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(SEARCH_QUERY)}`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 15000 });
    }

    console.log("Extracting product data...");
    const { data: products } = await stagehand.extract(
      "Extract the details of the FIRST 3 products in the search results. Get the product name, price, star rating, number of reviews, and the absolute href of the product page. The product URL must be a real Amazon link containing /dp/.",
      ProductsSchema,
    );

    const normalizedProducts = products.products.map((product) => ({
      ...product,
      product_url: new URL(product.product_url, "https://www.amazon.com").href,
    }));
    console.log("Products found:");
    console.log(JSON.stringify({ products: normalizedProducts }, null, 2));
  } catch (error) {
    console.error("Error during product scraping:", error);
    throw error;
  } finally {
    // Always close session to release resources and clean up.
    await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
    await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
    console.log("Session closed successfully");
  }
}

main().catch((err) => {
  console.error("Error in Amazon product scraping:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error("  - Verify network connectivity");
  console.error("Docs: https://docs.stagehand.dev");
  process.exit(1);
});

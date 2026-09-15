// Stagehand + Browserbase: AI-Powered Gift Finder - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import OpenAI from "openai";
import { z } from "zod/v4";

// ============= CONFIGURATION =============
// Update these values to customize your gift search
const CONFIG = {
  recipient: "Friend", // Options: "Mum", "Dad", "Sister", "Brother", "Friend", "Boss"
  description: "loves cooking and trying new recipes", // Describe their interests, hobbies, age, etc.
};
// =========================================

interface GiftFinderAnswers {
  recipient: string;
  description: string;
}

interface Product {
  title: string;
  url: string;
  price: string;
  rating: string;
  aiScore?: number;
  aiReason?: string;
}

interface SearchResult {
  query: string;
  sessionIndex: number;
  products: Product[];
}

async function closeSession(
  stagehand: Stagehand,
  browser: Awaited<ReturnType<typeof browserbase.launch>>,
) {
  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
}

function openAIClient(): { client: OpenAI; model: string } {
  if (process.env.AI_GATEWAY_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.AI_GATEWAY_API_KEY,
        baseURL: "https://ai-gateway.vercel.sh/v1",
      }),
      model: "openai/gpt-4.1",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: "gpt-4.1",
    };
  }
  throw new Error("AI_GATEWAY_API_KEY or OPENAI_API_KEY is required");
}

async function generateSearchQueries(recipient: string, description: string): Promise<string[]> {
  console.log(`Generating search queries for ${recipient}...`);

  // Use AI to generate search terms based on recipient profile
  // This avoids generic searches and focuses on thoughtful, complementary gifts
  const { client, model } = openAIClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: `Generate exactly 3 short gift search queries (1-2 words each) for finding gifts for a ${recipient.toLowerCase()} who is described as: "${description}".

IMPORTANT: Assume they already have the basic necessities related to their interests. Focus on:
- Complementary items that enhance their hobbies
- Thoughtful accessories or upgrades
- Related but unexpected items
- Premium or unique versions of things they might not buy themselves

AVOID obvious basics like "poker set" for poker players, "dumbbells" for fitness enthusiasts, etc.

Examples for "loves cooking":
spice rack
chef knife
herb garden

Return ONLY the search terms, one per line, no dashes, bullets, or numbers. Just the plain search terms:`,
      },
    ],
    max_completion_tokens: 1000,
  });

  // Parse AI response and clean up formatting
  const queries =
    response.choices[0]?.message?.content
      ?.trim()
      .split("\n")
      .filter((q) => q.trim()) || [];
  return queries.slice(0, 3);
}

async function scoreProducts(
  products: Product[],
  recipient: string,
  description: string,
): Promise<Product[]> {
  console.log("AI is analyzing gift options based on recipient profile...");

  // Flatten all products from multiple search sessions into single array
  const allProducts = products.flat();

  if (allProducts.length === 0) {
    console.log("No products to score");
    return [];
  }

  // Format products for AI analysis with index numbers for reference
  const productList = allProducts
    .map(
      (product, index) => `${index + 1}. ${product.title} - ${product.price} - ${product.rating}`,
    )
    .join("\n");

  console.log(`Scoring ${allProducts.length} products...`);

  const { client, model } = openAIClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: `You are a gift recommendation expert. Score each product based on how well it matches the recipient profile.

RECIPIENT: ${recipient}
DESCRIPTION: ${description}

PRODUCTS TO SCORE:
${productList}

For each product, provide a score from 1-10 (10 being perfect match) and a brief reason. Consider:
- How well it matches their interests/hobbies
- Appropriateness for the relationship (${recipient.toLowerCase()})
- Value for money
- Uniqueness/thoughtfulness
- Practical usefulness

Return ONLY a valid JSON array (no markdown, no code blocks) with this exact format:
[
  {
    "productIndex": 1,
    "score": 8,
    "reason": "Perfect for poker enthusiasts, high quality chips enhance the gaming experience"
  },
  {
    "productIndex": 2,
    "score": 6,
    "reason": "Useful but basic, might already own similar item"
  }
]

IMPORTANT:
- Return raw JSON only, no code blocks
- Include all ${allProducts.length} products
- Keep reasons under 100 characters
- Use productIndex 1-${allProducts.length}`,
      },
    ],
    max_completion_tokens: 1000,
  });

  // Clean up AI response by removing markdown code blocks
  let responseContent = response.choices[0]?.message?.content?.trim() || "[]";

  responseContent = responseContent.replace(/```json\n?/g, "").replace(/```\n?/g, "");

  const ScoreSchema = z.object({
    productIndex: z.number().int().min(1).max(allProducts.length),
    score: z.number().min(1).max(10),
    reason: z.string().min(1).max(100),
  });
  const scoresData = z
    .array(ScoreSchema)
    .length(allProducts.length)
    .parse(JSON.parse(responseContent));
  if (new Set(scoresData.map((score) => score.productIndex)).size !== allProducts.length) {
    throw new Error("OpenAI scoring did not return one unique score per product");
  }

  // Map AI scores back to products using index matching
  const scoredProducts = allProducts.map((product, index) => {
    const scoreInfo = scoresData.find((score) => score.productIndex === index + 1)!;
    return {
      ...product,
      aiScore: scoreInfo.score,
      aiReason: scoreInfo.reason,
    };
  });

  // Sort by AI score descending to show best matches first
  return scoredProducts.sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));
}

async function getUserInput(): Promise<GiftFinderAnswers> {
  console.log("Welcome to the Gift Finder App!");
  console.log("Find the perfect gift with intelligent web browsing");
  console.log(`\nSearching for gifts for: ${CONFIG.recipient}`);
  console.log(`Profile: ${CONFIG.description}\n`);

  // Validate description length
  if (CONFIG.description.trim().length < 5) {
    throw new Error(
      "Description must be at least 5 characters long. Please update the CONFIG at the top of the file.",
    );
  }

  return CONFIG;
}

async function main(): Promise<void> {
  console.log("Starting Gift Finder Application...");

  if (
    !process.env.BROWSERBASE_API_KEY ||
    (!process.env.AI_GATEWAY_API_KEY && !process.env.OPENAI_API_KEY)
  ) {
    throw new Error(
      "BROWSERBASE_API_KEY and either AI_GATEWAY_API_KEY or OPENAI_API_KEY are required",
    );
  }

  const { recipient, description } = await getUserInput();
  console.log(`User input received: ${recipient} - ${description}`);

  console.log("\nGenerating intelligent search queries...");

  const searchQueries = await generateSearchQueries(recipient, description);
  if (searchQueries.length !== 3) {
    throw new Error(`Expected 3 generated search queries, received ${searchQueries.length}`);
  }
  console.log("\nGenerated Search Queries:");
  searchQueries.forEach((query, index) => {
    console.log(`   ${index + 1}. ${query.replace(/['"]/g, "")}`);
  });

  console.log("\nStarting concurrent browser searches...");

  async function runSingleSearch(query: string, sessionIndex: number): Promise<SearchResult> {
    console.log(`Starting search session ${sessionIndex + 1} for: "${query}"`);

    // Create separate Stagehand instance for each search to run concurrently
    // Each session searches independently to maximize speed
    const sessionBrowser = await browserbase.launch({
      apiKey: process.env.BROWSERBASE_API_KEY!,
      region: "us-east-1",
      timeout: 900,
      browserSettings: {
        viewport: {
          width: 1920,
          height: 1080,
        },
      },
    });
    const sessionStagehand = await Stagehand.create({
      browser: sessionBrowser,
      model: { modelName: "openai/gpt-4.1" },
      logging: { level: "info" },
    });

    try {
      const sessionPage = (await sessionBrowser.context.pages())[0];

      // Navigate to European gift site - proxies help with regional access
      console.log(`Session ${sessionIndex + 1}: Navigating to Firebox.eu...`);
      await sessionPage.goto("https://firebox.eu/");

      // Perform search using natural language actions
      console.log(`Session ${sessionIndex + 1}: Searching for "${query}"...`);
      await sessionStagehand.act(`Type ${query} into the search bar`);
      await sessionStagehand.act("Click the search button");
      await sessionPage.waitForTimeout(1000);

      // Extract structured product data using Zod schema for type safety
      console.log(`Session ${sessionIndex + 1}: Extracting product data...`);
      const { data: productsData } = await sessionStagehand.extract(
        "Extract the first 3 products from the search results",
        z.object({
          products: z
            .array(
              z.object({
                title: z.string().describe("the title/name of the product"),
                url: z.string().describe("the full URL link to the product page"),
                price: z.string().describe("the price of the product (include currency symbol)"),
                rating: z
                  .string()
                  .describe(
                    "the star rating or number of reviews (e.g., '4.5 stars' or '123 reviews')",
                  ),
              }),
            )
            .max(3)
            .describe("array of the first 3 products from search results"),
        }),
      );

      const baseUrl = await sessionPage.url();
      const products = productsData.products.flatMap((product) => {
        if (!product.title.trim() || !product.url.trim()) return [];
        try {
          const url = new URL(product.url, baseUrl);
          if (url.protocol !== "http:" && url.protocol !== "https:") return [];
          return [{ ...product, url: url.href }];
        } catch {
          return [];
        }
      });

      console.log(`Session ${sessionIndex + 1}: Found ${products.length} products for "${query}"`);

      await closeSession(sessionStagehand, sessionBrowser);

      return {
        query,
        sessionIndex: sessionIndex + 1,
        products,
      };
    } catch (error) {
      console.error(`Session ${sessionIndex + 1} failed:`, error);

      await closeSession(sessionStagehand, sessionBrowser);

      return {
        query,
        sessionIndex: sessionIndex + 1,
        products: [],
      };
    }
  }

  const searchPromises = searchQueries.map((query, index) => runSingleSearch(query, index));

  console.log("\nBrowser Sessions Starting...");
  console.log("Search sessions are running concurrently");

  // Wait for all concurrent searches to complete
  const allResults = await Promise.all(searchPromises);
  const failedSearches = allResults.filter((result) => result.products.length === 0);
  if (failedSearches.length > 0) {
    console.warn(
      `${failedSearches.length} of ${allResults.length} gift searches produced no usable products; continuing with the successful results`,
    );
  }

  // Calculate total products found across all search sessions
  const totalProducts = allResults.reduce((sum, result) => sum + result.products.length, 0);
  console.log(`\nTotal products found: ${totalProducts} across ${searchQueries.length} searches`);

  // Flatten all products into single array for AI scoring
  const allProductsFlat = allResults.flatMap((result) => result.products);

  if (allProductsFlat.length < 3) {
    throw new Error(`Expected at least 3 products to rank, received ${allProductsFlat.length}`);
  }

  // AI scores all products and ranks them by relevance to recipient
  const scoredProducts = await scoreProducts(allProductsFlat, recipient, description);
  const top3Products = scoredProducts.slice(0, 3);

  console.log("\nTOP 3 RECOMMENDED GIFTS:");

  // Display top 3 products with AI reasoning for transparency
  top3Products.forEach((product, index) => {
    const rank = `#${index + 1}`;
    console.log(`\n${rank} - ${product.title}`);
    console.log(`Price: ${product.price}`);
    console.log(`Rating: ${product.rating}`);
    console.log(`Score: ${product.aiScore}/10`);
    console.log(`Why: ${product.aiReason}`);
    console.log(`Link: ${product.url}`);
  });

  console.log(
    `\nGift finding complete! Found ${totalProducts} products, analyzed ${scoredProducts.length} with AI.`,
  );

  console.log("\nThank you for using Gift Finder!");
}

main().catch((err) => {
  console.error("Application error:", err);
  process.exit(1);
});

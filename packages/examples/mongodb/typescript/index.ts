import { browserbase, Stagehand, type Page } from "@browserbasehq/stagehand";
import chalk from "chalk";
import { z } from "zod/v4";
import { MongoServerError } from "mongodb";
import { MongoClient, Db, Document } from "mongodb";

/**
 * 🤘 Welcome to Stagehand! Thanks so much for trying us out!
 * 📝 Check out our docs for more fun use cases, like building agents
 * https://docs.stagehand.dev/
 *
 * 💬 If you have any feedback, reach out to us on Slack!
 * https://stagehand.dev/slack
 *
 * 📚 You might also benefit from the docs for Zod, Browserbase, and Playwright:
 * - https://zod.dev/
 * - https://docs.browserbase.com/
 * - https://playwright.dev/docs/intro
 */

// ========== MongoDB Connection Configuration ==========
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "scraper_db";

let client: MongoClient | null = null;
let db: Db | null = null;

// ========== Schema Definitions ==========
// Product schema for e-commerce websites
const ProductSchema = z.object({
  url: z.string(),
  dateScraped: z.date(),
  name: z.string(),
  price: z.string(),
  rating: z.number().optional(),
  category: z.string().optional(),
  id: z.string().optional(),
  currency: z.string().optional(),
  imageUrl: z.string().optional(),
  reviewCount: z.number().optional(),
  description: z.string().optional(),
  specs: z.record(z.string(), z.any()).optional(),
}) satisfies z.ZodType<Document>;

// Product list schema for results from category pages
const ProductListSchema = z.object({
  products: z.array(ProductSchema),
  category: z.string().optional(),
  dateScraped: z.date(),
  totalProducts: z.number().optional(),
  page: z.number().optional(),
  websiteName: z.string().optional(),
}) satisfies z.ZodType<Document>;

// Types are inferred from the schemas
export type Product = z.infer<typeof ProductSchema>;
export type ProductList = z.infer<typeof ProductListSchema>;

// Collection names for MongoDB
const COLLECTIONS = {
  PRODUCTS: "products",
  PRODUCT_LISTS: "product_lists",
} as const;

// Index definitions for MongoDB collections
interface IndexDefinition {
  key: { [key: string]: number };
  name: string;
  unique?: boolean;
}

const INDEXES = {
  [COLLECTIONS.PRODUCTS]: [
    { key: { rating: 1 }, name: "rating_idx" } as IndexDefinition,
    { key: { category: 1 }, name: "category_idx" } as IndexDefinition,
    { key: { url: 1 }, name: "url_idx", unique: true } as IndexDefinition,
    { key: { dateScraped: -1 }, name: "dateScraped_idx" } as IndexDefinition,
  ],
  [COLLECTIONS.PRODUCT_LISTS]: [
    { key: { category: 1 }, name: "category_idx" } as IndexDefinition,
    { key: { dateScraped: -1 }, name: "dateScraped_idx" } as IndexDefinition,
  ],
} as const;

// Check and create indexes for all collections
async function createIndexes(db: Db): Promise<void> {
  console.log(chalk.blue("⚙️ Starting index creation..."));

  // First create all collections if they don't exist
  for (const collectionName of Object.keys(INDEXES)) {
    try {
      await db.createCollection(collectionName);
      console.log(chalk.green(`✅ Created collection: ${collectionName}`));
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 48) {
        console.log(chalk.yellow(`⚠️ Collection ${collectionName} already exists`));
      } else {
        console.error(chalk.red(`❌ Error creating collection ${collectionName}:`), error);
        throw error;
      }
    }
  }

  // Now create indexes for each collection
  for (const [collectionName, indexes] of Object.entries(INDEXES)) {
    console.log(chalk.blue(`⚙️ Processing indexes for collection: ${collectionName}`));
    const collection = db.collection(collectionName);

    for (const index of indexes) {
      try {
        console.log(
          chalk.blue(`⚙️ Creating index ${index.name} on ${collectionName} with keys:`, index.key),
        );
        const existingIndexes = await collection.listIndexes().toArray();
        const indexExists = existingIndexes.some((idx) => idx.name === index.name);

        if (indexExists) {
          console.log(chalk.yellow(`⚠️ Index ${index.name} already exists on ${collectionName}`));
        } else {
          await collection.createIndex(index.key, {
            name: index.name,
            unique: index.unique || false,
            background: false,
          });
          console.log(chalk.green(`✅ Created index ${index.name} on ${collectionName}`));
        }
      } catch (error) {
        console.error(
          chalk.red(`❌ Error creating index ${index.name} on ${collectionName}:`),
          error,
        );
      }
    }
  }

  // Verify indexes were created
  for (const [collectionName, indexes] of Object.entries(INDEXES)) {
    const collection = db.collection(collectionName);
    const existingIndexes = await collection.listIndexes().toArray();
    console.log(chalk.blue(`Indexes for ${collectionName}:`));
    console.log(existingIndexes);
  }

  console.log(chalk.green("✅ Index creation completed"));
}

// ========== MongoDB Utility Functions ==========
/**
 * Connects to MongoDB
 */
async function connectToMongo(): Promise<Db> {
  if (client) {
    console.log("Using existing MongoDB connection");
    return client.db(DB_NAME);
  }

  try {
    console.log("Connecting to MongoDB...");
    client = new MongoClient(MONGO_URI);
    await client.connect();

    console.log("Connected to MongoDB");

    // Verify if database exists
    const adminDb = client.db("admin");
    const databases = await adminDb.admin().listDatabases();
    const dbExists =
      databases.databases?.some((db: { name: string }) => db.name === DB_NAME) ?? false;

    if (!dbExists) {
      console.log(chalk.blue(`⚙️ Creating database: ${DB_NAME}`));
      // Create a collection to trigger database creation
      const db = client.db(DB_NAME);
      await db.createCollection(COLLECTIONS.PRODUCTS);
      console.log(chalk.green(`✅ Database ${DB_NAME} created successfully`));
    } else {
      console.log(chalk.yellow(`⚠️ Database ${DB_NAME} already exists`));
    }

    const db = client.db(DB_NAME);

    // Create indexes for all collections
    console.log("Creating indexes...");
    await createIndexes(db);
    console.log("Indexes created successfully");

    return db;
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
}

/**
 * Closes the MongoDB connection
 */
async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    console.log("MongoDB connection closed");
    client = null;
    db = null;
  }
}

/**
 * Stores data in a MongoDB collection
 */
async function storeData<T extends Document>(collectionName: string, data: T | T[]): Promise<void> {
  const db = await connectToMongo();

  // Ensure collection exists
  try {
    await db.createCollection(collectionName);
    console.log(chalk.green(`✅ Created collection: ${collectionName}`));
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 48) {
      console.log(chalk.yellow(`⚠️ Collection ${collectionName} already exists`));
    } else {
      console.error(chalk.red(`❌ Error creating collection ${collectionName}:`), error);
      throw error;
    }
  }

  const collection = db.collection(collectionName);

  try {
    if (Array.isArray(data)) {
      await collection.insertMany(data as Document[]);
    } else {
      await collection.insertOne(data as Document);
    }
    console.log(chalk.green(`✅ Stored data in ${collectionName}`));
  } catch (error) {
    console.error(chalk.red(`❌ Error storing data in ${collectionName}:`), error);
    throw error;
  }
}

/**
 * Finds documents in a MongoDB collection
 */
async function findData<T>(collectionName: string, query = {}): Promise<T[]> {
  const database = await connectToMongo();
  const collection = database.collection(collectionName);

  try {
    const documents = await collection.find(query).toArray();
    return documents as T[];
  } catch (error) {
    console.error(`Error finding data in ${collectionName}:`, error);
    throw error;
  }
}

/**
 * Aggregates data in a MongoDB collection
 */
async function aggregateData<T>(collectionName: string, pipeline: object[]): Promise<T[]> {
  const database = await connectToMongo();
  const collection = database.collection(collectionName);

  try {
    const results = await collection.aggregate(pipeline).toArray();
    return results as T[];
  } catch (error) {
    console.error(`Error aggregating data in ${collectionName}:`, error);
    throw error;
  }
}

// ========== Scraping Functions ==========
/**
 * Scrapes a product list from an Amazon category page
 */
async function scrapeProductList(
  page: Page,
  categoryUrl: string,
  stagehand: Stagehand,
): Promise<ProductList> {
  // Navigate to Amazon homepage first
  await page.goto("https://www.amazon.com");
  await page.waitForTimeout(2000);

  // Then navigate to the category page
  await page.goto(categoryUrl);

  // Wait for products to load
  await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 });
  await page.waitForTimeout(2000);

  // Scroll to load more products
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight / 2);
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(1000);

  const listSchema = z.object({
    products: z.array(
      z.object({
        name: z.string(),
        price: z.string(),
        url: z.string(),
        rating: z.number().optional(),
        reviewCount: z.number().optional(),
      }),
    ),
    category: z.string(),
    totalProducts: z.number().optional(),
  });

  const { data } = await stagehand.extract(
    "Extract all product information from this Amazon category page, including product names, prices, URLs, ratings",
    listSchema,
  );

  const products = data.products.map((product: (typeof data.products)[number]) => ({
    ...product,
    dateScraped: new Date(),
  }));

  // Create the product list object
  const productList: ProductList = {
    products: products,
    category: data.category,
    dateScraped: new Date(),
    totalProducts: products.length,
    websiteName: "Amazon",
  };

  // Store the data in MongoDB
  await storeData(COLLECTIONS.PRODUCT_LISTS, productList);
  await storeData(COLLECTIONS.PRODUCTS, products);

  return productList;
}

/**
 * Scrapes detailed information for a single product
 */
async function scrapeProductDetails(
  page: Page,
  productUrl: string,
  stagehand: Stagehand,
): Promise<Product> {
  await page.goto(productUrl);

  // Wait for the page to load
  await page.waitForTimeout(2000);

  // Scroll down to load more content
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight / 3);
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.scrollTo(0, (document.body.scrollHeight * 2) / 3);
  });
  await page.waitForTimeout(1000);

  const { data: product } = await stagehand.extract(
    "Extract detailed product information from this Amazon product page, including name, price, description, specifications, brand, category, image URL, rating, review count, and availability",
    ProductSchema.omit({ dateScraped: true }),
  );

  // Add additional data
  const completeProduct: Product = {
    ...product,
    url: productUrl,
    dateScraped: new Date(),
  };

  // Store the data in MongoDB
  await storeData(COLLECTIONS.PRODUCTS, completeProduct);

  return completeProduct;
}

// ========== Data Analysis Functions ==========
/**
 * Run queries on the collected data
 */
async function runQueries(): Promise<void> {
  try {
    // Connect to MongoDB
    await connectToMongo();
    console.log(chalk.blue("🔌 Connected to MongoDB"));

    // Define types for MongoDB query results
    interface CategoryCount {
      _id: string | null;
      count: number;
    }

    // 1. Get total counts for each collection using MongoDB's native countDocuments
    console.log(chalk.yellow("\n📊 Collection Counts:"));
    if (!db) throw new Error("MongoDB connection not established");
    for (const [name, collection] of Object.entries(COLLECTIONS)) {
      const count = await db.collection(collection).countDocuments();
      console.log(`${chalk.green(name)}: ${count} documents`);
    }

    // 2. Products by category
    console.log(chalk.yellow("\n📊 Products by Category:"));
    const productsByCategory = await aggregateData<CategoryCount>(COLLECTIONS.PRODUCTS, [
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    console.table(
      productsByCategory.map((item) => ({
        Category: item._id || "Unknown",
        Count: item.count,
      })),
    );

    // 3. Find highest rated products
    console.log(chalk.yellow("\n📊 Top Rated Products:"));
    // First get the count of highly rated products
    if (!db) throw new Error("MongoDB connection not established");
    const count = await db.collection(COLLECTIONS.PRODUCTS).countDocuments({ rating: { $gte: 4 } });
    console.log(chalk.yellow(`Found ${count} highly rated products (4+ stars)`));

    // Only fetch and display the products if there are any
    if (count > 0) {
      const highestRatedProducts = await findData(COLLECTIONS.PRODUCTS, { rating: { $gte: 4 } });
      console.table(
        highestRatedProducts.map((product: any) => ({
          Name: product.name,
          Price: product.price,
          Rating: product.rating,
          Category: product.category || "Unknown",
        })),
      );
    }

    console.log(chalk.green("\n✅ Queries completed successfully!"));
  } catch (error) {
    console.error(chalk.red("❌ Error running queries:"), error);
  }
}

// ========== Main Function ==========
async function main({ page, stagehand }: { page: Page; stagehand: Stagehand }) {
  try {
    // Connect to MongoDB
    const db = await connectToMongo();

    // Verify indexes were created
    console.log(chalk.blue("Verifying indexes..."));
    for (const [collectionName, indexes] of Object.entries(INDEXES)) {
      const collection = db.collection(collectionName);
      const existingIndexes = await collection.listIndexes().toArray();
      console.log(chalk.blue(`Indexes for ${collectionName}:`));
      console.log(existingIndexes);
    }

    // Define the category URL for Amazon electronics
    const categoryUrl = "https://www.amazon.com/s?k=laptops";

    console.log(chalk.blue("📊 Starting to scrape product listing..."));

    // Scrape product listing
    const productList = await scrapeProductList(page, categoryUrl, stagehand);
    console.log(
      chalk.green(
        `✅ Scraped ${productList.products.length} products from category: ${productList.category}`,
      ),
    );

    // Scrape detailed information for the first 3 products
    const productsToScrape = productList.products.slice(0, 3);

    for (const [index, product] of productsToScrape.entries()) {
      console.log(
        chalk.blue(
          `📊 Scraping details for product ${index + 1}/${productsToScrape.length}: ${product.name}`,
        ),
      );

      try {
        // Scrape product details
        const detailedProduct = await scrapeProductDetails(page, product.url, stagehand);
        console.log(chalk.green(`✅ Scraped detailed information for: ${detailedProduct.name}`));

        // Wait between requests to avoid rate limiting
        await page.waitForTimeout(2000);
      } catch (error) {
        console.error(chalk.red(`❌ Error scraping product ${product.name}:`), error);
      }
    }

    // Run queries on the collected data
    await runQueries();

    console.log(chalk.green("🎉 Scraping and MongoDB operations completed successfully!"));
  } catch (error) {
    console.error(chalk.red("❌ Error during scraping:"), error);
  } finally {
    // Close MongoDB connection
    await closeMongo();
  }
}

// ========== Entry Point ==========
async function run() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY is required");

  const browser = await browserbase.launch({
    apiKey,
    browserSettings: {
      blockAds: true,
      viewport: { width: 1024, height: 768 },
    },
  });
  const stagehand = await Stagehand.create({
    browser,
    logging: { level: "info", format: "pretty" },
  });

  console.log(`View this session live: https://browserbase.com/sessions/${browser.sessionId}`);

  const [page] = await browser.context.pages();

  await main({
    page,
    stagehand,
  });

  await stagehand.close();
  await browser.close();
}

run();

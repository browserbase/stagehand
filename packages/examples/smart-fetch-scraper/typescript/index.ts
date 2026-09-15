// Stagehand + Browserbase: Smart Fetch Scraper - See README.md for full documentation
//
// Tries the Browserbase Fetch API first (fast, no browser session needed).
// If the page is JS-rendered or the content is insufficient, falls back to
// a full Stagehand browser session with AI-powered extraction.
//
// Note: the Fetch API can return content as `raw` HTML, clean `markdown`,
// or schema-extracted `json` — pass `format: "markdown"` or `format: "json"`
// (with a JSON schema) to `bb.fetchAPI.create` to skip writing your own
// HTML parser. Docs: https://docs.browserbase.com/platform/fetch/overview

import "dotenv/config";
import Browserbase from "@browserbasehq/sdk";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// ============= CONFIGURATION =============

// Minimum character threshold — if Fetch API returns less than this,
// the page is likely JS-rendered and we fall back to a browser session.
const MIN_CONTENT_LENGTH = 500;

// Minimum ratio of visible text to raw HTML — pages below this are likely shells.
const MIN_TEXT_DENSITY = 0.05;

// Patterns that indicate the page requires JavaScript to render real content.
const JS_REQUIRED_PATTERNS = [
  /enable javascript/i,
  /javascript is (required|disabled|not enabled)/i,
  /please enable javascript/i,
  /this (site|page|app) requires javascript/i,
  /checking your browser/i, // Cloudflare challenge
  /<noscript>[^<]{200,}/i, // large noscript block = JS-gated content
];

// Schema for the structured data extracted by the browser fallback.
// Adapt this to match the content you want to pull from the target page.
const PageDataSchema = z.object({
  title: z.string().describe("The page title"),
  items: z
    .array(
      z.object({
        title: z.string().describe("The headline or item title"),
        url: z.string().describe("The link URL"),
        metadata: z.string().describe("Any subtitle, score, author, or timestamp info"),
      }),
    )
    .describe("The main list of items, articles, or entries on the page"),
});

// =========================================

/**
 * Returns the reason the Fetch API result should trigger a browser fallback,
 * or null if the content looks usable.
 */
function needsBrowserFallback(content: string, statusCode: number): string | null {
  // Non-2xx status: the page didn't load successfully
  if (statusCode < 200 || statusCode >= 300) {
    return `non-2xx status code (${statusCode})`;
  }

  // Too short: likely a JS shell
  if (content.length < MIN_CONTENT_LENGTH) {
    return `content too short (${content.length} < ${MIN_CONTENT_LENGTH} chars)`;
  }

  // JS-challenge / bot-detection page
  for (const pattern of JS_REQUIRED_PATTERNS) {
    if (pattern.test(content)) {
      return `JS-required pattern matched: ${pattern}`;
    }
  }

  // Low text density: strip all HTML tags and measure how much real text remains
  const textOnly = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const density = textOnly.length / content.length;
  if (density < MIN_TEXT_DENSITY) {
    return `text density too low (${(density * 100).toFixed(1)}% < ${MIN_TEXT_DENSITY * 100}%)`;
  }

  return null;
}

/**
 * Attempt to fetch a page using the Browserbase Fetch API.
 * This is a lightweight HTTP request — no browser spins up.
 * Returns the raw HTML content or null if the content fails usability checks.
 */
async function tryFetchApi(url: string): Promise<{ content: string; statusCode: number } | null> {
  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

  console.log("[Fetch API] Attempting lightweight fetch...");

  try {
    // Tip: pass `format: "markdown"` or `format: "json"` (with a `schema`)
    // here to have Browserbase return cleaner content or structured data
    // directly — see https://docs.browserbase.com/platform/fetch/overview
    const data = await bb.fetchAPI.create({ url, allowRedirects: true });
    const content = typeof data.content === "string" ? data.content : JSON.stringify(data.content);

    console.log(
      `[Fetch API] Got response: status=${data.statusCode}, length=${content.length} chars`,
    );

    const fallbackReason = needsBrowserFallback(content, data.statusCode);
    if (fallbackReason) {
      console.log(`[Fetch API] Content not usable — ${fallbackReason}`);
      return null;
    }

    return { content, statusCode: data.statusCode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[Fetch API] Failed: ${message}`);
    return null;
  }
}

/**
 * Parse basic data from raw HTML without a browser.
 * Uses simple regex-based extraction — swap in cheerio for richer parsing.
 */
function parseFromHtml(html: string): { title: string; linkCount: number } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Unknown";
  const linkCount = (html.match(/<a\s/gi) || []).length;
  return { title, linkCount };
}

/**
 * Fall back to a full Stagehand browser session for JS-heavy pages.
 * Uses AI-powered extraction to pull structured data from the rendered DOM.
 */
async function extractWithBrowser(url: string) {
  console.log("\n[Browser] Starting Stagehand session...");

  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    proxies: true,
    browserSettings: {
      advancedStealth: true,
      blockAds: true,
      solveCaptchas: true,
    },
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    logging: { level: "info" },
  });

  try {
    const page = (await browser.context.pages())[0];
    await page.goto(url);

    console.log("[Browser] Page loaded, extracting structured data with AI...");

    const { data: data } = await stagehand.extract(
      "Extract the page title and all the main items/articles/entries visible on this page. For each item get its title, URL, and any metadata like score, author, or timestamp.",
      PageDataSchema,
    );

    return data;
  } finally {
    await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
    await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
    console.log("[Browser] Session closed");
  }
}

async function main(): Promise<void> {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error("Usage: npm start <url>");
    console.error("Example: npm start https://news.ycombinator.com");
    process.exit(1);
  }

  console.log(`Smart Fetch Scraper — target: ${targetUrl}`);
  console.log("Strategy: Fetch API first, browser fallback if needed\n");

  try {
    // Step 1: Try the fast path
    const fetchResult = await tryFetchApi(targetUrl);

    if (fetchResult) {
      console.log("\n[Fetch API] Success! Parsing HTML content...");
      const parsed = parseFromHtml(fetchResult.content);
      console.log(`  Title: ${parsed.title}`);
      console.log(`  Links found: ${parsed.linkCount}`);
      console.log(`  Status code: ${fetchResult.statusCode}`);
      console.log(`  Content length: ${fetchResult.content.length} chars`);
      console.log("\nThe Fetch API returned sufficient content.");
      console.log("For richer structured extraction, the browser fallback is also available.\n");

      // Optionally, you can still use the browser for richer extraction:
      // const structured = await extractWithBrowser(targetUrl);
      // console.log(JSON.stringify(structured, null, 2));

      console.log("Preview (first 500 chars):");
      console.log(fetchResult.content.slice(0, 500));
    } else {
      // Step 2: Fetch API didn't return usable content — use a real browser
      console.log("\n[Fetch API] Insufficient content, falling back to browser...\n");

      const structured = await extractWithBrowser(targetUrl);
      console.log("\nExtracted data:");
      console.log(JSON.stringify(structured, null, 2));
    }
  } catch (error) {
    console.error("Error during scrape:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error("Error:", err);
  console.error("Common issues:");
  console.error("  - Check .env has BROWSERBASE_API_KEY");
  console.error("  - Verify network connectivity");
  console.error("Docs: https://docs.stagehand.dev");
  process.exit(1);
});

import { Stagehand, ConstructorParams } from "@browserbasehq/stagehand";
import { z } from "zod";

export interface SearchResult {
  title: string;
  snippet: string;
}

export interface BrowserSession {
  browserbaseSessionId: string;
  attemptId: string;
}

// Simulate network disconnection with lower failure rate for better success
function simulateNetworkDisconnect(stage: string): void {
  // 15% chance of network failure - more realistic and allows eventual success
  if (Math.random() < 0.15) {
    const failures = [
      "ECONNRESET: Connection reset by peer",
      "ETIMEDOUT: Connection timed out",
      "ENOTFOUND: DNS lookup failed",
      "ECONNREFUSED: Connection refused",
    ];
    const failure = failures[Math.floor(Math.random() * failures.length)];
    console.error(`Network disconnection during ${stage}: ${failure}`);
    throw new Error(`Network failure during ${stage}: ${failure}`);
  }
  console.log(`Network OK for ${stage}`);
}

// Validate with fallback - more lenient to ensure we get data
function validateSearchResults(results: any[]): SearchResult[] {
  if (!results || results.length === 0) {
    throw new Error("No search results extracted - page structure may have changed");
  }

  console.log(`Validating ${results.length} raw results...`);

  // First try strict validation
  let validResults = results.filter(
    (r) =>
      r.title &&
      r.snippet &&
      r.title.length > 5 &&
      r.snippet.length > 10 &&
      r.title !== "null" && // Reject 'null' string values
      r.snippet !== "null",
  );

  // Fallback to more lenient validation if strict fails
  if (validResults.length === 0) {
    console.log("Strict validation failed, trying lenient validation...");
    validResults = results
      .filter(
        (r) =>
          r.title &&
          r.title.length > 2 &&
          r.snippet &&
          r.title !== "null" && // Still reject 'null' string values
          r.snippet !== "null",
      )
      .map((r) => ({
        title: r.title,
        snippet: r.snippet || r.description || "Description not available",
      }));
  }

  if (validResults.length === 0) {
    console.error("Raw extraction data:", JSON.stringify(results, null, 2));
    // Check if we hit a CAPTCHA or other blocking page
    const hasNullValues = results.some(
      (r) => r.title === "null" || r.snippet === "null" || r.title === null || r.snippet === null,
    );
    if (hasNullValues) {
      throw new Error(
        "Extraction returned null values - likely hit CAPTCHA or blocking page. Retrying...",
      );
    }
    throw new Error("No valid search results found - extracted data was completely malformed");
  }

  console.log(`Validated ${validResults.length} search results`);
  return validResults;
}

/**
 * Activity 1: Initialize browser session
 * Atomic: Only responsible for creating and initializing a browser session
 * Idempotent: Returns session data that can be used to reconnect
 */
export async function initializeBrowser(): Promise<BrowserSession> {
  const attemptId = Math.random().toString(36).substring(2, 8);
  console.log(`\n[${attemptId}] Initializing new browser session`);

  try {
    // Network failure during initialization (15% chance)
    simulateNetworkDisconnect("browser initialization");

    const config: ConstructorParams = {
      verbose: 0,
      domSettleTimeoutMs: 8000,
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY,
      modelName: "openai/gpt-4o",
      modelClientOptions: {
        apiKey: process.env.OPENAI_API_KEY,
      },
      browserbaseSessionCreateParams: {
        // Only available in paid plans
        // proxies: true,
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        browserSettings: {
          viewport: {
            width: 1024,
            height: 768,
          },
          // Only available on Scale Plans
          // advancedStealth: true
        },
      },
    };

    console.log(`[${attemptId}] Creating new browser session...`);
    const stagehand = new Stagehand(config);
    await stagehand.init();

    // Get the Browserbase session ID to reconnect later
    const browserbaseSessionId = stagehand.browserbaseSessionID;
    if (!browserbaseSessionId) {
      throw new Error("Failed to get Browserbase session ID");
    }

    console.log(`[${attemptId}] Browser session initialized with ID: ${browserbaseSessionId}`);

    return { browserbaseSessionId, attemptId };
  } catch (error: any) {
    console.error(`[${attemptId}] Failed to initialize browser:`, error.message);
    throw error;
  }
}

/**
 * Helper function to reconnect to an existing Browserbase session
 */
async function reconnectToSession(session: BrowserSession): Promise<Stagehand> {
  console.log(`[${session.attemptId}] Reconnecting to session: ${session.browserbaseSessionId}`);

  const config: ConstructorParams = {
    verbose: 1,
    domSettleTimeoutMs: 8000,
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    browserbaseSessionID: session.browserbaseSessionId,
  };

  const stagehand = new Stagehand(config);
  await stagehand.init();

  // Browserbase requires at least one page in the session
  // If reconnecting to a session with no pages, we need to create one
  if (!stagehand.page) {
    console.log(`[${session.attemptId}] No page found in session, creating new page...`);
    throw new Error("Failed to create page in Browserbase session");
  }

  return stagehand;
}

/**
 * Activity 2: Navigate to search page
 * Atomic: Only responsible for navigation
 * Idempotent: Multiple calls result in same state (on Google homepage)
 */
export async function navigateToSearchPage(session: BrowserSession): Promise<void> {
  console.log(
    `\n[${session.attemptId}] Navigating to search page for session: ${session.browserbaseSessionId}`,
  );

  let stagehand: Stagehand | null = null;

  try {
    // Network failure during navigation (15% chance)
    simulateNetworkDisconnect("page navigation");

    stagehand = await reconnectToSession(session);

    console.log(`[${session.attemptId}] Navigating to Brave...`);
    await stagehand.page.goto("https://search.brave.com/");
    console.log(`[${session.attemptId}] Successfully navigated to Brave`);
  } catch (error: any) {
    console.error(`[${session.attemptId}] Navigation failed:`, error.message);
    throw error;
  }
}

/**
 * Activity 3: Execute search
 * Atomic: Only responsible for performing the search
 * Idempotent: Same query produces same search action
 */
export async function executeSearch(session: BrowserSession, query: string): Promise<void> {
  console.log(`\n[${session.attemptId}] Executing search for: "${query}"`);

  let stagehand: Stagehand | null = null;

  try {
    // Network failure during search (15% chance)
    simulateNetworkDisconnect("search execution");

    stagehand = await reconnectToSession(session);

    console.log(`[${session.attemptId}] Typing search query...`);
    await stagehand.page.act({
      action: `Type "${query}" in the search box`,
    });

    await stagehand.page.act({
      action: "Click the enter button",
    });

    // Wait for search results to load
    console.log(`[${session.attemptId}] Waiting for results to load...`);
    await stagehand.page.waitForTimeout(4000);
  } catch (error: any) {
    console.error(`[${session.attemptId}] Search execution failed:`, error.message);
    throw error;
  }
}

/**
 * Activity 4: Extract search results
 * Atomic: Only responsible for extraction and validation
 * Idempotent: Multiple extractions from same page state produce same results
 */
export async function extractSearchResults(session: BrowserSession): Promise<SearchResult[]> {
  console.log(`\n[${session.attemptId}] Extracting search results...`);

  let stagehand: Stagehand | null = null;

  try {
    // Network failure during extraction (15% chance)
    simulateNetworkDisconnect("data extraction");

    stagehand = await reconnectToSession(session);

    // Check if we've been redirected to a CAPTCHA or blocking page
    const currentUrl = stagehand.page.url();
    console.log(`[${session.attemptId}] Current URL: ${currentUrl}`);

    if (currentUrl.includes("/sorry/") || currentUrl.includes("captcha")) {
      throw new Error("Detected CAPTCHA/blocking page - need to retry with new session");
    }

    console.log(`[${session.attemptId}] Performing extraction...`);

    const extraction = await stagehand.page.extract({
      instruction: `Extract the top 3 organic search results from Google.
      For each result, get:
      - title: The main headline/title text
      - snippet: The description text below the title
      Ignore ads, images, shopping results, and featured snippets.`,
      schema: z.object({
        results: z
          .array(
            z.object({
              title: z.string().describe("The main headline of the search result"),
              snippet: z.string().describe("The description text"),
            }),
          )
          .min(1),
      }),
    });

    console.log(`[${session.attemptId}] Raw extraction:`, JSON.stringify(extraction, null, 2));

    // Validate the extracted data
    const validResults = validateSearchResults(extraction.results);

    console.log(
      `[${session.attemptId}] Successfully extracted ${validResults.length} search results!`,
    );
    return validResults;
  } catch (error: any) {
    console.error(`[${session.attemptId}] Extraction failed:`, error.message);
    throw error;
  }
}

/**
 * Activity 5: Cleanup browser session
 * Atomic: Only responsible for cleanup
 * Idempotent: Multiple calls safely handle already-closed sessions
 */
export async function cleanupBrowser(session: BrowserSession): Promise<void> {
  console.log(
    `\n[${session.attemptId}] Cleaning up browser session: ${session.browserbaseSessionId}`,
  );

  try {
    const stagehand = await reconnectToSession(session);
    await stagehand.close();
    console.log(
      `[${session.attemptId}] Browser session ${session.browserbaseSessionId} cleaned up`,
    );
  } catch (e) {
    console.warn(`[${session.attemptId}] Failed to close browser session:`, e);
    // Session might already be closed or expired - that's ok
  }
}

/**
 * Activity 6: Format results
 * Atomic: Only responsible for formatting
 * Idempotent: Same input produces same output
 */
export async function formatResults(results: SearchResult[]): Promise<string> {
  if (results.length === 0) {
    throw new Error("Cannot format empty results - this indicates a data extraction issue");
  }

  const formatted = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n`).join("\n");

  return `Successfully found ${results.length} search results:\n\n${formatted}`;
}

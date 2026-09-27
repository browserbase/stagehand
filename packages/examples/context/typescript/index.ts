// Stagehand + Browserbase: Context Authentication Example - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { Browserbase } from "@browserbasehq/sdk";
import { z } from "zod/v4";

async function createSessionContextID() {
  const email = process.env.SF_REC_PARK_EMAIL;
  const password = process.env.SF_REC_PARK_PASSWORD;
  if (!process.env.BROWSERBASE_API_KEY || !email || !password) {
    throw new Error(
      "BROWSERBASE_API_KEY, SF_REC_PARK_EMAIL, and SF_REC_PARK_PASSWORD are required",
    );
  }

  console.log("Creating new Browserbase context...");
  // First create a context using Browserbase SDK to get a context ID.
  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
  const context = await bb.contexts.create();

  console.log("Created Browserbase context");

  // Create a single session using the context ID to perform initial login.
  console.log("Creating session for initial login...");
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    browserSettings: {
      context: {
        id: context.id,
        persist: true, // Save authentication state to context
      },
    },
  });
  console.log("Live View is available in the Browserbase Sessions dashboard");
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1" },
    logging: { level: "info" },
  });

  // Connect to existing session for login process.

  const page = (await browser.context.pages())[0];
  // Navigate to login page with extended timeout for slow-loading sites.
  console.log("Navigating to SF Rec & Park login page...");
  await page.goto("https://www.rec.us/organizations/san-francisco-rec-park", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Perform login sequence: each step is atomic to handle dynamic page changes.
  console.log("Starting login sequence...");
  await stagehand.act("Click the Login button");
  await stagehand.act(`Fill in the email or username field with "${email}"`);
  await stagehand.act("Click the next, continue, or submit button to proceed");
  await stagehand.act(`Fill in the password field with "${password}"`);
  await stagehand.act("Click the login, sign in, or submit button");
  console.log("Login sequence completed!");

  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
  console.log("Authentication state saved to context");

  // Return the context ID for reuse in future sessions.
  return { id: context.id };
}

async function deleteContext(contextId: string) {
  try {
    console.log("Cleaning up Browserbase context");
    const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
    // The generated SDK currently sets a JSON content type on DELETE, so send an
    // explicit empty object instead of an empty body.
    await bb.contexts.delete(contextId, { body: {} });
    console.log("Context deleted successfully");
  } catch (error: unknown) {
    console.error("Error deleting context:", error instanceof Error ? error.message : error);
  }
}

async function main() {
  console.log("Starting Context Authentication Example...");
  // Create context with login state for reuse in authenticated sessions.
  const contextId = await createSessionContextID();

  // Initialize new session using existing context to inherit authentication state.
  // persist: true ensures any new changes (cookies, cache) are saved back to context.
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    browserSettings: {
      context: {
        id: contextId.id,
        persist: true,
      },
    },
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1" },
    logging: { level: "info" },
  });

  // Creates session with inherited login state from context.
  console.log("Authenticated session ready!");

  const page = (await browser.context.pages())[0];

  // Navigate to authenticated area - should skip login due to persisted cookies.
  console.log("Navigating to authenticated area (should skip login)...");
  await page.goto("https://www.rec.us/organizations/san-francisco-rec-park", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Navigate to user-specific area to access personal data.
  await stagehand.act("Click on the reservations button");

  // Extract structured user data using Zod schema for type safety.
  // Schema ensures consistent data format and validates extracted content.
  console.log("Extracting user profile data...");
  const { data: userData } = await stagehand.extract(
    "Extract the user's full name and address",
    z.object({
      fullName: z.string().min(1).describe("the user's full name"),
      address: z.string().min(1).describe("the user's address"),
    }),
  );

  console.log("Extracted user data:", userData);

  // Always close session to release resources and save any context changes.
  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
  console.log("Session closed successfully");

  // Clean up context to prevent accumulation and ensure security.
  await deleteContext(contextId.id);
}

main().catch((err) => {
  console.error("Error in context authentication example:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has SF_REC_PARK_EMAIL and SF_REC_PARK_PASSWORD");
  console.error("  - Verify BROWSERBASE_API_KEY is set");
  console.error("  - Ensure credentials are valid for SF Rec & Park");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});

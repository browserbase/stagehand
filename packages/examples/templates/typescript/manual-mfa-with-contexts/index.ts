// Manual MFA with Browserbase Contexts - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { Browserbase } from "@browserbasehq/sdk";
import { z } from "zod/v4";

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY,
});

/**
 * First session: Create context and login (with MFA)
 */
async function createSessionWithContext() {
  console.log("Creating new Browserbase context...");

  const context = await bb.contexts.create();

  console.log("Browserbase context created");
  console.log("First session: Performing login with MFA...");

  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    browserSettings: {
      context: {
        id: context.id,
        persist: true, // Save authentication state including MFA
      },
    },
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1-mini" },
    logging: { level: "error" },
  });

  console.log("Live View is available in the Browserbase Sessions dashboard");

  const page = (await browser.context.pages())[0];

  // Navigate to GitHub login
  console.log("Navigating to GitHub login...");
  await page.goto("https://github.com/login");
  await page.waitForLoadState("domcontentloaded");

  // Fill in credentials
  console.log("Entering username...");
  await stagehand.act(`Type '${process.env.GITHUB_USERNAME}' into the username field`);

  console.log("Entering password...");
  await stagehand.act(`Type '${process.env.GITHUB_PASSWORD}' into the password field`);

  console.log("Clicking Sign in...");
  await stagehand.act("Click the Sign in button");

  await page.waitForLoadState("networkidle");

  // Check if MFA is required
  const { data: mfaRequired } = await stagehand.extract(
    "Is there a two-factor authentication or verification code prompt on the page?",
    z.boolean(),
  );

  if (mfaRequired) {
    console.log("MFA DETECTED!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("PAUSED: Please complete MFA in the browser");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("1. Open the newest running session in the Browserbase Sessions dashboard");
    console.log("2. Enter your 2FA code from authenticator app");
    console.log("3. Click 'Verify' or submit");
    console.log("4. Wait for login to complete");
    console.log("\nThe script will wait for you to complete MFA...\n");

    // Wait for MFA completion (poll until we're no longer on login page)
    let loginComplete = false;
    const startTime = Date.now();
    const timeout = 120000; // 2 minutes

    while (!loginComplete && Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Check every 3 seconds

      const currentUrl = await page.url();
      if (!currentUrl.includes("/login") && !currentUrl.includes("/sessions/two-factor")) {
        loginComplete = true;
      }
    }

    if (!loginComplete) {
      throw new Error("MFA timeout - login was not completed within 2 minutes");
    }

    console.log("MFA completed! Login successful.\n");
  } else {
    console.log("Login successful (no MFA required)\n");
  }

  console.log("The Browserbase context now contains:");
  console.log("   - Session cookies");
  console.log("   - MFA trust/remember device state");
  console.log("   - All authentication data\n");

  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));

  return context.id;
}

/**
 * Second session: Reuse context - NO MFA needed!
 */
async function reuseContext(contextId: string) {
  console.log("Second session: Reusing the saved context");
  console.log("   (No login, no MFA required - auth state persisted)\n");

  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    browserSettings: {
      context: {
        id: contextId,
        persist: true,
      },
    },
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1-mini" },
    logging: { level: "error" },
  });

  console.log("Live View is available in the Browserbase Sessions dashboard");

  const page = (await browser.context.pages())[0];

  // Navigate directly to GitHub (should already be logged in)
  console.log("Navigating to GitHub...");
  await page.goto("https://github.com");
  await page.waitForLoadState("networkidle");

  const { data: username } = await stagehand.extract(
    "Extract the logged-in GitHub username. Return an empty string if the page is not authenticated.",
    z.string(),
  );

  console.log("\nReused context opened GitHub without another login step.");
  console.log(`   Username: ${username}`);
  console.log("\nThis is the power of Browserbase Contexts:");
  console.log("   - First session: User completes MFA once");
  console.log("   - Context saves trusted device state");
  console.log("   - All future sessions: No MFA required\n");

  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
}

/**
 * Clean up context
 */
async function deleteContext(contextId: string) {
  console.log("Deleting Browserbase context");
  try {
    // The generated SDK currently sets a JSON content type on DELETE, so send an
    // explicit empty object instead of an empty body.
    await bb.contexts.delete(contextId, { body: {} });
    console.log("Context deleted\n");
  } catch (error) {
    console.log(
      `Could not delete context: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log("   Context will auto-expire after 30 days\n");
  }
}

async function main() {
  console.log("Starting Browserbase Context MFA Persistence Demo...");

  // Check environment variables
  if (!process.env.BROWSERBASE_API_KEY) {
    console.error("\n❌ Missing Browserbase credentials");
    console.error("   Set BROWSERBASE_API_KEY in .env");
    process.exit(1);
  }

  if (!process.env.GITHUB_USERNAME || !process.env.GITHUB_PASSWORD) {
    console.error("\nError: Missing GitHub credentials");
    console.error("   Set GITHUB_USERNAME and GITHUB_PASSWORD in .env");
    console.error("Setup Instructions:");
    console.error("   1. Create a test GitHub account");
    console.error("   2. Enable 2FA: Settings → Password and authentication");
    console.error("   3. Set credentials in .env file");
    process.exit(1);
  }

  try {
    console.log("\n📋 Demo Flow:");
    console.log("   1. First session: Login + complete MFA manually");
    console.log("   2. Second session: No login, no MFA needed");
    console.log("   3. Clean up context\n");

    // First session: Create context and login with MFA
    const contextId = await createSessionWithContext();

    console.log("⏳ Waiting 5 seconds before reusing context...\n");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Second session: Reuse context (NO MFA!)
    await reuseContext(contextId);

    // Clean up
    await deleteContext(contextId);

    console.log("═══════════════════════════════════════════════════════════");
    console.log("Key Takeaway:");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("✅ First session: User completes MFA once");
    console.log("✅ Context saves trusted device state");
    console.log("✅ All future sessions: No MFA prompt");
    console.log("✅ Store context_id per customer in database\n");
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
    console.error("\nTroubleshooting:");
    console.error("  - Ensure GitHub credentials are correct");
    console.error("  - Ensure 2FA is enabled on the test account");
    console.error("  - Check Browserbase dashboard for session details");
    throw error;
  }
}

main().catch((err) => {
  console.error("Application error:", err);
  process.exit(1);
});

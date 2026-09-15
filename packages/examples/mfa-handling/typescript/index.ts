// Stagehand + Browserbase: MFA Handling - TOTP Automation - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import crypto from "crypto";

// Demo site URL for TOTP challenge testing
const DEMO_URL = "https://authenticationtest.com/totpChallenge/";

// Generate TOTP code (Time-based One-Time Password) using RFC 6238 compliant algorithm
// Same algorithm used by Google Authenticator, Authy, and other authenticator apps
function generateTOTP(secret: string, window = 0): string {
  // Convert base32 secret to buffer
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  let hex = "";

  secret = secret.toUpperCase().replace(/=+$/, "");

  for (let i = 0; i < secret.length; i++) {
    const val = base32chars.indexOf(secret.charAt(i));
    if (val === -1) throw new Error("Invalid base32 character in secret");
    bits += val.toString(2).padStart(5, "0");
  }

  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.substr(i, 4);
    hex += parseInt(chunk, 2).toString(16);
  }

  const secretBuffer = Buffer.from(hex, "hex");

  // Get current time window (30 second intervals)
  const time = Math.floor(Date.now() / 1000 / 30) + window;
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigInt64BE(BigInt(time));

  // Generate HMAC-SHA1 hash
  const hmac = crypto.createHmac("sha1", secretBuffer);
  hmac.update(timeBuffer);
  const hmacResult = hmac.digest();

  // Dynamic truncation to extract 6-digit code
  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  // Return 6-digit code with leading zeros
  return (code % 1000000).toString().padStart(6, "0");
}

async function main() {
  console.log("Starting MFA Handling - TOTP Automation...");

  // Initialize Stagehand with Browserbase for cloud-based browser automation
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "google/gemini-2.5-flash" },
    logging: { level: "error" },
  });

  try {
    // Initialize browser session to start automation

    console.log("Stagehand initialized successfully!");
    const page = (await browser.context.pages())[0];

    // Navigate to TOTP challenge demo page
    console.log("Navigating to TOTP Challenge page...");
    await page.goto(DEMO_URL, {
      waitUntil: "domcontentloaded",
    });

    // Extract test credentials and TOTP secret from the page
    console.log("Extracting test credentials and TOTP secret...");
    const { data: credentials } = await stagehand.extract(
      "Extract the test email, password, and TOTP secret key shown on the page",
      z.object({
        email: z.string(),
        password: z.string(),
        totpSecret: z.string().describe("The TOTP secret key for generating codes"),
      }),
    );

    console.log(`Credentials extracted - Email: ${credentials.email}`);

    // Fill in login form with email and password
    console.log("Filling in email...");
    await stagehand.act(`Type '${credentials.email}' into the email field`);

    console.log("Filling in password...");
    await stagehand.act(`Type '${credentials.password}' into the password field`);

    // Generate the short-lived code only after the slower semantic actions.
    let secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (secondsLeft < 12) {
      console.log(`Waiting ${secondsLeft + 1} seconds for a fresh TOTP window...`);
      await page.waitForTimeout((secondsLeft + 1) * 1000);
    }
    const totpCode = generateTOTP(credentials.totpSecret);
    secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
    console.log(`Generated TOTP code: ${totpCode} (valid for ${secondsLeft} seconds)`);

    // Fill in TOTP code
    console.log("Filling in TOTP code...");
    await stagehand.act(`Type '${totpCode}' into the TOTP code field`);

    // Submit the form
    console.log("Submitting form...");
    await stagehand.act("Click the submit or login button");

    // Wait for response - be tolerant of sites that never reach full "networkidle"
    try {
      console.log("Waiting for page to finish loading after submit...");
      await page.waitForLoadState("networkidle", 15000);
    } catch (err) {
      console.warn(
        "Timed out waiting for 'networkidle' after submit; continuing because the login likely succeeded.",
        err,
      );
    }

    // Check if login succeeded
    console.log("Checking authentication result...");
    const { data: result } = await stagehand.extract(
      "Check if the login was successful or if there's an error message",
      z.object({
        success: z.boolean(),
        message: z.string(),
      }),
    );

    if (result.success) {
      console.log("SUCCESS! TOTP authentication completed automatically!");
      console.log("Authentication Result:", JSON.stringify(result, null, 2));
    } else {
      console.log("Authentication may have failed. Message:", result.message);
      console.log("Retrying with a fresh TOTP code...");

      // Regenerate and retry with new code (handles time window edge cases)
      // A failed submission navigates to a separate failure page, so return to
      // the challenge before filling and submitting a fresh code.
      await page.goto(DEMO_URL, { waitUntil: "domcontentloaded" });

      secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
      if (secondsLeft < 8) {
        console.log(`Waiting ${secondsLeft + 1} seconds for a fresh TOTP window...`);
        await page.waitForTimeout((secondsLeft + 1) * 1000);
      }

      await stagehand.act(`Type '${credentials.email}' into the email field`);
      await stagehand.act(`Type '${credentials.password}' into the password field`);

      const newCode = generateTOTP(credentials.totpSecret);
      console.log(`New TOTP code: ${newCode}`);
      await stagehand.act(`Type '${newCode}' into the TOTP code field`);
      await stagehand.act("Click the submit or login button");

      try {
        console.log("Waiting for page to finish loading after retry submit...");
        await page.waitForLoadState("networkidle", 15000);
      } catch (err) {
        console.warn(
          "Timed out waiting for 'networkidle' after retry submit; continuing because the login likely succeeded.",
          err,
        );
      }

      const { data: retryResult } = await stagehand.extract(
        "Check if the login was successful",
        z.boolean(),
      );

      if (retryResult) {
        console.log("Success on retry!");
      } else {
        throw new Error("Authentication failed after retry");
      }
    }
  } catch (error) {
    console.error("Error during MFA handling:", error);
    throw error;
  } finally {
    // Always close session to release resources and clean up
    await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
    await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
    console.log("Session closed successfully");
  }
}

main().catch((err) => {
  console.error("Error in MFA handling:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error("  - TOTP code may have expired (try running again)");
  console.error("  - Page structure may have changed");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});

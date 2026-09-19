// Basic reCAPTCHA Solving with Browserbase - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";

async function main() {
  // Initialize Stagehand with Browserbase for cloud-based browser automation.
  // Enable captcha solving in browser settings for automatic reCAPTCHA handling.

  const solveCaptchas = true; // Set to false to disable automatic captcha solving (true by default)

  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    browserSettings: {
      solveCaptchas: solveCaptchas,
    },
  });
  const stagehand = await Stagehand.create({ browser: browser, logging: { level: "info" } });

  try {
    // Initialize browser session to start automation.

    console.log("Stagehand initialized successfully!");
    const page = (await browser.context.pages())[0];

    // Navigate to Google reCAPTCHA demo page to test captcha solving.
    console.log("Navigating to reCAPTCHA demo page...");
    await page.goto("https://google.com/recaptcha/api2/demo");

    // Wait for Browserbase to solve the captcha automatically.
    // Listen for console messages indicating captcha solving progress.
    if (solveCaptchas) {
      console.log("Waiting for captcha to be solved...");
      let resolveCaptcha!: () => void;
      const captchaSolved = new Promise<void>((resolve) => {
        resolveCaptcha = resolve;
      });
      const subscription = await page.on("console", (event) => {
        const args = event.params.args;
        if (!Array.isArray(args)) return;
        const message = args
          .map((arg) => {
            if (typeof arg === "object" && arg !== null && !Array.isArray(arg) && "value" in arg) {
              return String(arg.value);
            }
            return "";
          })
          .join(" ");

        if (message === "browserbase-solving-started") {
          console.log("Captcha solving in progress...");
        } else if (message === "browserbase-solving-finished") {
          console.log("Captcha solving completed!");
          resolveCaptcha();
        }
      });
      await captchaSolved;
      await subscription.unsubscribe();
    } else {
      console.log("Captcha solving is disabled. Skipping wait...");
    }

    // Click submit again after captcha is solved to complete the form submission.
    console.log("Clicking submit button after captcha is solved...");
    await stagehand.act("Click the Submit button");

    // Extract and display the page content after submission.
    console.log("Extracting page content...");
    const { data: text } = await stagehand.extract("Extract all the text on this page");
    console.log("Page content:");
    console.log(text);
  } catch (error) {
    console.error("Error during reCAPTCHA solving:", error);
  } finally {
    // Always close session to release resources and clean up.
    await stagehand.close();
    await browser.close();
    console.log("Session closed successfully");
  }
}

main().catch((err) => {
  console.error("Error in reCAPTCHA solving example:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error("  - Verify solveCaptchas is enabled in browserSettings");
  console.error("  - Ensure the demo page is accessible");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});

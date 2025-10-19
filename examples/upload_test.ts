// Import directly from local dist to ensure latest build is used
import { Stagehand } from "../dist";
import type { Page as PlaywrightPage } from "playwright";
import StagehandConfig from "../stagehand.config";

// Load environment variables
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

async function main() {
  // Accept file URL as command line argument or use default
  const fileUrl = process.argv[2] || "https://www.orimi.com/pdf-test.pdf";
  const targetPage =
    process.argv[3] || "https://ps.uci.edu/~franklin/doc/file_upload.html";

  console.log(`File URL: ${fileUrl}`);
  console.log(`Target page: ${targetPage}`);

  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "BROWSERBASE",
    verbose: 1,
    modelName: "openai/gpt-4o-mini",
  });
  await stagehand.init();
  const page = stagehand.page;

  try {
    // Navigate to the target page
    await page.goto(targetPage, {
      waitUntil: "domcontentloaded",
    });

    // Debug: check presence of file inputs before calling upload
    const count = await page.locator('input[type="file"]').count();
    console.log("file input count:", count);

    // Debug: log accessibility tree (full)
    try {
      const ax = await page.evaluate(() => {
        if (typeof window.getComputedStyle !== 'undefined') {
          return document.querySelector('body')?.innerHTML || 'No body content';
        }
        return 'Accessibility snapshot not available';
      });
      console.log("Page content:");
      console.log(ax);
    } catch (e) {
      console.log("Failed to get page content:", e);
    }

    // Upload using the new helper - let observe find the right input
    // Now we can pass the URL directly since upload() handles URLs
    const result = await stagehand.upload("Upload this file", fileUrl);
    console.log("upload result:", result);

    // Try to submit the form using observe to find the submit button
    try {
      const [submitAction] = await page.observe(
        "Find and click the submit or send button",
      );
      if (submitAction?.selector) {
        console.log(
          `Found submit button with selector: ${submitAction.selector}`,
        );

        // Avoid mixed-content warning by upgrading http action → https when possible
        try {
          await page.evaluate(() => {
            const form = document.querySelector(
              "form",
            ) as HTMLFormElement | null;
            if (
              form &&
              typeof form.action === "string" &&
              form.action.startsWith("http://")
            ) {
              form.action = form.action.replace("http://", "https://");
            }
          });
        } catch {
          // ignore non-fatal submit upgrade errors
        }

        await page.act(submitAction);
        console.log("Form submitted successfully");
      } else {
        console.log("No submit button found via observe");
      }
    } catch (e) {
      console.log("Failed to find submit button via observe:", e);
    }

    await page.waitForTimeout(1500);
  } finally {
    await stagehand.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

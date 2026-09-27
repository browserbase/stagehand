// Stagehand + Browserbase: Philadelphia Council Events Scraper - See README.md for full documentation
import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const CURRENT_YEAR = new Date().getUTCFullYear();

/** Searches the current Philadelphia Council calendar and extracts event information. */
async function main() {
  console.log("Starting Philadelphia Council Events automation...");

  // Initialize Stagehand with Browserbase for cloud-based browser automation
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1" },
    logging: { level: "info" },
  });

  try {
    let page = (await browser.context.pages())[0];

    console.log("Navigating to: https://phila.legistar.com/");
    await page.goto("https://phila.legistar.com/");

    console.log("Clicking calendar from the navigation menu");
    const calendar = await stagehand.act("click calendar from the navigation menu");
    if (!calendar.data.success) {
      throw new Error(calendar.data.message || "Could not open the calendar");
    }

    console.log(`Selecting ${CURRENT_YEAR} from the year dropdown`);
    const selection = await stagehand.act(`select ${CURRENT_YEAR} from the year dropdown`);
    if (!selection.data.success) {
      throw new Error(selection.data.message || `Could not select ${CURRENT_YEAR}`);
    }
    page = (await browser.context.activePage()) ?? page;
    if (!(await page.url()).includes("Calendar.aspx")) {
      await page.goto("https://phila.legistar.com/Calendar.aspx", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    }
    await stagehand.observe(`Find the calendar table rows for ${CURRENT_YEAR}`);

    // Extract event data using AI to parse the structured information
    console.log("Extracting event information...");
    const EventResultsSchema = z.object({
      results: z.array(
        z.object({
          name: z.string(),
          date: z.string(),
          time: z.string(),
        }),
      ),
    });
    const { data: results } = await stagehand.extract(
      `Extract every ${CURRENT_YEAR} event currently visible in the calendar table, including its name, date, and time`,
      EventResultsSchema,
    );

    console.log(`Found ${results.results.length} events for ${CURRENT_YEAR}`);
    console.log("Event data extracted successfully:");
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error("Error during event extraction:", error);

    // Provide helpful troubleshooting information
    console.error("\nCommon issues:");
    console.error("1. Check .env file has BROWSERBASE_API_KEY");
    console.error("2. Ensure internet access and https://phila.legistar.com is accessible");
    console.error("3. Verify Browserbase account has sufficient credits");
    console.error("4. Check if the calendar page structure has changed");

    throw error;
  } finally {
    try {
      await stagehand.close();
    } catch (error) {
      console.warn("Stagehand cleanup warning:", error);
    }
    try {
      await browser.close();
    } catch (error) {
      console.warn("Browser cleanup warning:", error);
    }
  }
}

main().catch((err) => {
  console.error("Application error:", err);
  process.exit(1);
});

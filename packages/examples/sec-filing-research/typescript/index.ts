// Stagehand + Browserbase: SEC Filing Downloader - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

async function closeSession(
  stagehand: Stagehand,
  browser: Awaited<ReturnType<typeof browserbase.launch>>,
) {
  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
}

// Search query - can be company name, ticker symbol, or CIK number
// Examples: "Apple Inc", "AAPL", "0000320193"
const SEARCH_QUERY = "Apple Inc";
const COMPANY_CIK = "0000320193";

// Number of filings to retrieve
const NUM_FILINGS = 5;

const CompanyInfoSchema = z.object({
  companyName: z.string().min(1),
  cik: z.string().min(1),
});

const FilingsSchema = z.object({
  filings: z.array(
    z.object({
      type: z.string().min(1),
      date: z.string().min(1),
      description: z.string().nullable(),
      accessionNumber: z.string().nullable(),
      fileNumber: z.string().nullable(),
    }),
  ),
});

// Result shape returned after extracting company and filing metadata from SEC EDGAR
interface SECFilingResult {
  company: string;
  cik: string;
  searchQuery: string;
  filings: Array<{
    type: string;
    date: string;
    description: string;
    accessionNumber: string;
    fileNumber: string;
  }>;
}

/**
 * Searches SEC EDGAR for a company (by name, ticker, or CIK) and extracts
 * recent filing metadata: type, date, description, accession number, file number.
 * Uses Stagehand + Browserbase for AI-powered browser automation.
 */
async function main(): Promise<void> {
  console.log("Starting SEC Filing Downloader...");
  console.log(`Search query: ${SEARCH_QUERY}`);
  console.log(`Retrieving ${NUM_FILINGS} most recent filings\n`);

  // Initialize Stagehand with Browserbase for cloud-based browser automation
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "google/gemini-2.5-flash" },
    logging: { level: "info" },
  });

  try {
    // Initialize browser session

    console.log("Stagehand initialized successfully!");

    let page = (await browser.context.pages())[0];

    console.log("\nNavigating to SEC EDGAR...");
    await page.goto("https://www.sec.gov/edgar/searchedgar/companysearch.html", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    try {
      await stagehand.act("Click on the Company and Person Lookup search textbox");
      await stagehand.act(`Type "${SEARCH_QUERY}" in the search field`);
      await stagehand.act("Click the search submit button");
      await stagehand.act(`Click on "${SEARCH_QUERY}" in the search results to view their filings`);
    } catch (error) {
      console.warn("Semantic SEC navigation did not complete; checking its postcondition", error);
    }
    page = (await browser.context.activePage()) ?? page;
    if (!(await page.url()).includes("/edgar/browse/")) {
      await page.goto(`https://www.sec.gov/edgar/browse/?CIK=${COMPANY_CIK}&owner=exclude`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    }

    let companyInfo = { companyName: SEARCH_QUERY, cik: COMPANY_CIK };
    try {
      const extractedCompany = await stagehand.extract(
        "Extract the official company name and numeric CIK from the page header or company information section",
        CompanyInfoSchema,
      );
      companyInfo = extractedCompany.data;
    } catch (error) {
      // Company metadata is already known from the search target; a
      // transient structured-output failure should not discard filing results.
      console.warn("Company metadata extraction failed; using the search target", error);
    }

    console.log(`Extracting the ${NUM_FILINGS} most recent filings...`);
    const { data: extracted } = await stagehand.extract(
      `Extract the ${NUM_FILINGS} most recent SEC filings from the filings table. For each filing return its type, filing date, description, accession number, and file or film number when shown.`,
      FilingsSchema,
    );

    // Build result object with company info and normalized filing list
    const result: SECFilingResult = {
      company: companyInfo.companyName,
      cik: companyInfo.cik || COMPANY_CIK,
      searchQuery: SEARCH_QUERY,
      filings: extracted.filings.slice(0, NUM_FILINGS).map((filing) => ({
        ...filing,
        description: filing.description ?? "",
        accessionNumber: filing.accessionNumber ?? "",
        fileNumber: filing.fileNumber ?? "",
      })),
    };

    // Log summary and per-filing details to console
    console.log("\n" + "=".repeat(60));
    console.log("SEC FILING METADATA");
    console.log("=".repeat(60));
    console.log(`Company: ${result.company}`);
    console.log(`CIK: ${result.cik}`);
    console.log(`Search Query: ${result.searchQuery}`);
    console.log(`Filings Retrieved: ${result.filings.length}`);
    console.log("=".repeat(60));

    // Display each filing's type, date, description, accession number, file number
    result.filings.forEach((filing, index) => {
      console.log(`\nFiling ${index + 1}:`);
      console.log(`  Type: ${filing.type}`);
      console.log(`  Date: ${filing.date}`);
      console.log(
        `  Description: ${filing.description.substring(0, 80)}${filing.description.length > 80 ? "..." : ""}`,
      );
      console.log(`  Accession Number: ${filing.accessionNumber}`);
      console.log(`  File Number: ${filing.fileNumber}`);
    });

    // Output full result as JSON for piping or integration
    console.log("\n" + "=".repeat(60));
    console.log("JSON OUTPUT:");
    console.log("=".repeat(60));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error during SEC filing extraction:", error);
    throw error;
  } finally {
    // Always close session to release resources and clean up
    await closeSession(stagehand, browser);
    console.log("\nSession closed successfully");
  }
}

main().catch((err) => {
  console.error("Application error:", err);
  // Provide helpful troubleshooting information
  console.error("\nCommon issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error("  - Verify internet connection and SEC website accessibility");
  console.error("  - Ensure the search query is valid (company name, ticker, or CIK)");
  console.error("\nDocs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});

// Stagehand + Browserbase + Extend: Download Expense Receipts and Parse with Extend AI - See README.md for full documentation

import "dotenv/config";
import { Browserbase } from "@browserbasehq/sdk";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { ExtendClient } from "extend-ai";

// Polls Browserbase API for completed downloads with retry logic.
// Retries every 2 seconds until downloads are ready or timeout is reached.
async function saveDownloadsWithRetry(
  bb: Browserbase,
  sessionId: string,
  timeoutSecs: number = 60,
): Promise<number> {
  console.log(`Waiting up to ${timeoutSecs} seconds for downloads to complete...`);
  const deadline = Date.now() + timeoutSecs * 1000;

  while (Date.now() < deadline) {
    try {
      console.log("Checking for downloads...");
      const response = await bb.sessions.downloads.list(sessionId);
      const buf = Buffer.from(await response.arrayBuffer());

      if (buf.byteLength > 100) {
        console.log(`Downloads ready! File size: ${buf.byteLength} bytes`);
        fs.writeFileSync("downloaded_files.zip", buf);
        console.log("Files saved as: downloaded_files.zip");
        return buf.byteLength;
      }
      console.log("Downloads not ready yet, retrying...");
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      // HTML error response - session may not be ready yet, keep retrying
      if (errorMessage.includes("Unexpected token '<'") || errorMessage.includes("<html")) {
        console.log("Session not ready yet, retrying...");
      } else {
        console.error("Error fetching downloads:", e);
        throw e;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Download timeout exceeded");
}

// Extracts receipt files from downloaded zip archive into output directories
function extractFilesFromZip(zipPath: string, outputDir: string = "output/documents"): string[] {
  console.log(`Extracting files from ${zipPath}...`);

  // Create output directories for documents and results if they don't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  if (!fs.existsSync("output/results")) {
    fs.mkdirSync("output/results", { recursive: true });
  }

  // Open zip file and iterate over entries
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (entries.length === 0) {
    throw new Error("No files found in the downloaded zip");
  }

  // Extract all non-directory entries and collect file paths
  const extractedFiles: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) {
      const outputPath = path.join(outputDir, entry.entryName);
      zip.extractEntryTo(entry, outputDir, false, true);
      console.log(`Extracted: ${outputPath}`);
      extractedFiles.push(outputPath);
    }
  }

  console.log(`\nTotal files extracted: ${extractedFiles.length}`);
  return extractedFiles;
}

// Receipt extraction config for Extend AI
// Uses extraction_light base extractor with parse_performance engine for low latency
const receiptExtractionConfig = {
  baseProcessor: "extraction_light",
  baseVersion: "3.4.0",
  parseConfig: {
    engine: "parse_performance",
    target: "markdown",
    blockOptions: {
      text: {
        agentic: { enabled: false },
        signatureDetectionEnabled: false,
      },
      tables: {
        agentic: { enabled: false },
        targetFormat: "markdown",
        cellBlocksEnabled: false,
        tableHeaderContinuationEnabled: false,
      },
      figures: {
        enabled: false,
        figureImageClippingEnabled: false,
      },
    },
    engineVersion: "1.0.1",
    advancedOptions: {
      engine: "parse_performance",
      agenticOcrEnabled: false,
      pageBreaksEnabled: true,
      pageRotationEnabled: false,
      verticalGroupingThreshold: 1,
    },
    chunkingStrategy: { type: "document" },
  },
  schema: {
    type: "object",
    required: [
      "vendor_name",
      "receipt_date",
      "receipt_number",
      "total_amount",
      "subtotal_amount",
      "tax_amount",
      "line_items",
      "payment_method",
    ],
    properties: {
      vendor_name: {
        type: ["string", "null"],
        description: "The name of the merchant or vendor on the receipt.",
      },
      receipt_date: {
        type: ["string", "null"],
        description: "The date of the transaction shown on the receipt.",
        "extend:type": "date",
      },
      receipt_number: {
        type: ["string", "null"],
        description: "The receipt or transaction number, if present.",
      },
      total_amount: {
        type: "object",
        required: ["amount", "iso_4217_currency_code"],
        properties: {
          amount: { type: ["number", "null"] },
          iso_4217_currency_code: { type: ["string", "null"] },
        },
        description: "The total amount paid on the receipt.",
        "extend:type": "currency",
        additionalProperties: false,
      },
      subtotal_amount: {
        type: "object",
        required: ["amount", "iso_4217_currency_code"],
        properties: {
          amount: { type: ["number", "null"] },
          iso_4217_currency_code: { type: ["string", "null"] },
        },
        description: "The subtotal before tax, if shown.",
        "extend:type": "currency",
        additionalProperties: false,
      },
      tax_amount: {
        type: "object",
        required: ["amount", "iso_4217_currency_code"],
        properties: {
          amount: { type: ["number", "null"] },
          iso_4217_currency_code: { type: ["string", "null"] },
        },
        description: "The tax amount on the receipt.",
        "extend:type": "currency",
        additionalProperties: false,
      },
      line_items: {
        type: "array",
        items: {
          type: "object",
          required: ["description", "quantity", "unit_price", "amount"],
          properties: {
            description: {
              type: ["string", "null"],
              description: "Description of the item purchased.",
            },
            quantity: {
              type: ["number", "null"],
              description: "Quantity of the item, if shown.",
            },
            unit_price: {
              type: ["number", "null"],
              description: "Price per unit, if shown.",
            },
            amount: {
              type: ["number", "null"],
              description: "Total amount for this line item.",
            },
          },
          additionalProperties: false,
        },
        description: "Individual items on the receipt.",
      },
      payment_method: {
        type: ["string", "null"],
        description: "The payment method used (e.g., cash, credit card, etc.).",
      },
    },
    additionalProperties: false,
  },
  advancedOptions: {
    advancedMultimodalEnabled: false,
    citationsEnabled: true,
    arrayCitationStrategy: "item",
    pageRanges: [],
    chunkingOptions: {},
    advancedFigureParsingEnabled: true,
  },
};

// Uploads receipt files to Extend AI, runs extraction, and saves results as JSON and CSV
async function parseReceiptsWithExtend(filePaths: string[]): Promise<void> {
  // Skip parsing if Extend API key is not configured
  if (!process.env.EXTEND_API_KEY || process.env.EXTEND_API_KEY === "YOUR_EXTEND_API_KEY_HERE") {
    console.log("\nWARNING: EXTEND_API_KEY not configured. Skipping receipt parsing.");
    console.log("   Add your Extend API key to .env to enable automatic receipt parsing.");
    return;
  }

  console.log("\n=== Parsing Receipts with Extend AI ===\n");

  // Initialize Extend AI client
  // SDK auto-retries 429s and 5xx errors with exponential backoff
  const client = new ExtendClient({ token: process.env.EXTEND_API_KEY });

  console.log(`Processing ${filePaths.length} receipts with inline config...\n`);

  // Process all files - SDK handles retries automatically with exponential backoff
  const results: { file: string; runId?: string; data: unknown }[] = [];

  // Process in batches of 9 to balance speed and reliability
  for (let i = 0; i < filePaths.length; i += 9) {
    const batch = filePaths.slice(i, i + 9);
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        const fileName = path.basename(filePath);
        try {
          // Upload the file to Extend
          const fileBuffer = fs.readFileSync(filePath);
          const blob = new Blob([fileBuffer]);
          const uploadResponse = await client.files.upload(
            blob as Parameters<typeof client.files.upload>[0],
            {},
          );
          const fileId = uploadResponse.id;

          // Run extraction using inline config — no need to pre-create an extractor resource
          const result = await client.extract(
            {
              config: receiptExtractionConfig as Parameters<typeof client.extract>[0]["config"],
              file: { id: fileId },
            },
            { maxRetries: 4 },
          );

          const runId = result.id;
          console.log(`  Parsed ${fileName} (run: ${runId})`);
          return { file: fileName, runId, data: result };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`  Failed to parse ${fileName}:`, errorMsg);
          return { file: fileName, data: { error: errorMsg } };
        }
      }),
    );
    results.push(...batchResults);
  }

  // Save results to JSON
  const jsonPath = "output/results/receipts.json";
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved JSON: ${jsonPath}`);

  // Convert results to CSV for easy viewing in spreadsheet tools
  const csvRows: string[] = [];
  csvRows.push(
    "file,vendor_name,receipt_date,receipt_number,total_amount,currency,subtotal,tax,payment_method,line_items_count",
  );

  // Shape of the extracted receipt data from Extend extract runs
  type ReceiptOutput = {
    vendor_name?: string;
    receipt_date?: string;
    receipt_number?: string;
    total_amount?: { amount?: string; iso_4217_currency_code?: string };
    subtotal_amount?: { amount?: string };
    tax_amount?: { amount?: string };
    payment_method?: string;
    line_items?: unknown[];
  };

  // Build CSV rows from extraction results
  for (const result of results) {
    const data = result.data as { output?: { value?: ReceiptOutput } } | undefined;
    const output: ReceiptOutput = data?.output?.value || {};
    const row = [
      result.file,
      output.vendor_name || "",
      output.receipt_date || "",
      output.receipt_number || "",
      output.total_amount?.amount ?? "",
      output.total_amount?.iso_4217_currency_code || "",
      output.subtotal_amount?.amount ?? "",
      output.tax_amount?.amount ?? "",
      output.payment_method || "",
      Array.isArray(output.line_items) ? output.line_items.length : 0,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
    csvRows.push(row);
  }

  const csvPath = "output/results/receipts.csv";
  fs.writeFileSync(csvPath, csvRows.join("\n"));
  console.log(`Saved CSV:  ${csvPath}`);
}

async function main(): Promise<void> {
  console.log("Starting Expense Receipt Downloader...\n");

  if (!process.env.BROWSERBASE_API_KEY) {
    throw new Error("BROWSERBASE_API_KEY is required");
  }

  // Initialize Browserbase SDK for session management and download retrieval
  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY as string,
  });

  // V4's browser factory provisions and owns the Stagehand extension.
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const sessionId = browser.sessionId;
  if (!sessionId) throw new Error("Browserbase launch did not return a session ID");
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "google/gemini-2.5-flash" },
    logging: { level: "info" },
  });

  try {
    // Initialize browser session to start automation

    console.log("Stagehand initialized successfully!");
    const page = (await browser.context.pages())[0];
    console.log("Live View is available in the Browserbase Sessions dashboard");

    // Navigate to the expense portal where receipts are hosted
    console.log("\nNavigating to expense portal...");
    await page.goto("https://v0-reimburse-me-expense-portal.vercel.app/", {
      waitUntil: "domcontentloaded",
    });

    // Use observe to find all individual download buttons (not the Download All button)
    console.log("\nFinding all individual download buttons...");
    const { data: downloadButtons } = await stagehand.observe(
      "Find all the small Download links on individual receipt cards.",
    );
    if (downloadButtons.length === 0) throw new Error("No receipt download links were found");

    // Click each download button using observe → act pattern
    // Pass the observed action directly to act for precise element targeting
    let successCount = 0;
    for (let i = 0; i < downloadButtons.length; i++) {
      const action = downloadButtons[i];
      console.log(`Downloading receipt ${i + 1}/${downloadButtons.length}...`);

      try {
        await stagehand.act(action, { page });
        successCount++;
      } catch (_clickError) {
        // If click fails, scroll element into view and retry
        console.log(`  Could not click download button ${i + 1}, trying to scroll and retry...`);
        try {
          await stagehand.act("Scroll down slightly", { page });
          await stagehand.act(action, { page });
          successCount++;
        } catch {
          console.log(`  Skipping receipt ${i + 1}`);
        }
      }

      // Scroll down periodically to ensure elements are in view
      if ((i + 1) % 4 === 0 && i + 1 < downloadButtons.length) {
        await stagehand.act("Scroll down slightly", { page });
      }
    }

    console.log(
      `\nDownload clicks completed! (${successCount}/${downloadButtons.length} successful)`,
    );

    // Retrieve all downloads triggered during this session from Browserbase API
    if (sessionId) {
      console.log("\nRetrieving downloads from Browserbase...");

      // Close the browser session before fetching downloads
      await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
      await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));

      // Wait for session to finalize downloads before polling
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const downloadSize = await saveDownloadsWithRetry(bb, sessionId, 60);

        if (downloadSize > 0) {
          // Extract receipt files from downloaded zip archive
          const extractedFiles = extractFilesFromZip("downloaded_files.zip");

          console.log("\n=== Download Summary ===");
          console.log(`Total files downloaded: ${extractedFiles.length}`);
          console.log("Files saved to: ./output/documents/");

          // Parse downloaded receipts with Extend AI for structured data extraction
          await parseReceiptsWithExtend(extractedFiles);
        } else {
          console.log("No downloads were captured");
        }
      } catch (downloadError) {
        console.error("Download retrieval failed:", downloadError);
        throw downloadError;
      }
    }

    console.log("\nExpense receipt download complete!");
  } catch (error) {
    console.error("Error during automation:", error);
    try {
      await stagehand.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    } catch {
      // Ignore close errors during cleanup
    }
    throw error;
  }
}

main().catch((err) => {
  console.error("Application error:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error("  - Add EXTEND_API_KEY to .env to enable receipt parsing with Extend AI");
  console.error("  - Verify internet connection and expense portal accessibility");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});

// Stagehand + Browserbase: Image URL Download - See README.md for full documentation
//
// Uses Stagehand extract() to find all image URLs on a page, then downloads each
// image through the Browserbase Fetch API. Works for any image format (JPG, PNG,
// WebP, etc.).

import "dotenv/config";
import { Browserbase } from "@browserbasehq/sdk";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import fs from "fs";
import path from "path";

// ============= CONFIGURATION =============

// Maximum number of images to download per run.
// Increase this if you need more images, or set MAX_IMAGES in your .env.
const MAX_IMAGES = parseInt(process.env.MAX_IMAGES ?? "10", 10) || 10;

// Directory (relative to where the script is run) where images are saved.
const OUTPUT_DIR = "./images";

// =========================================

// Maps MIME types to file extensions for the most common image formats.
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

/**
 * Derive a safe filename from an image URL and its detected MIME type.
 * Takes the last path segment for the base name, uses the MIME type for the
 * extension (more reliable than trusting the URL), and appends a timestamp
 * so repeated runs never overwrite earlier downloads.
 */
function imageFilename(url: string, mimeType: string, index: number): string {
  const ext = MIME_TO_EXT[mimeType] ?? "bin";
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    // Strip any existing extension — we'll use the one from the actual MIME type.
    const base = segment.replace(/\.[^.]+$/, "") || `image-${index}`;
    // Sanitize to filesystem-safe characters.
    const safe = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    return `${safe}-${Date.now()}.${ext}`;
  } catch {
    return `image-${index}-${Date.now()}.${ext}`;
  }
}

async function main(): Promise<void> {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error("Usage: npm start <url>");
    console.error("Example: npm start https://www.browserbase.com");
    process.exit(1);
  }

  console.log(`Image URL Download — target: ${targetUrl}`);
  console.log(`Max images: ${MAX_IMAGES} | Output: ${OUTPUT_DIR}/<hostname>/\n`);

  if (!process.env.BROWSERBASE_API_KEY) {
    throw new Error("BROWSERBASE_API_KEY is required");
  }
  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });

  // Initialize Stagehand with Browserbase for cloud-based browser automation.
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "google/gemini-2.5-flash" },
    logging: { level: "info" },
  });

  try {
    // Initialize browser session to start automation.

    console.log("Stagehand initialized successfully!");
    const page = (await browser.context.pages())[0];
    const exactDomImageUrls = async (): Promise<string[]> =>
      (await page.evaluate(() => {
        const urls = new Set<string>();
        for (const image of Array.from(document.images)) {
          if (image.currentSrc) urls.add(image.currentSrc);
          if (image.src) urls.add(image.src);
        }
        for (const element of Array.from(document.querySelectorAll<HTMLElement>("[style]"))) {
          const background = getComputedStyle(element).backgroundImage;
          for (const match of background.matchAll(/url\(["']?(.*?)["']?\)/g)) {
            if (match[1]) urls.add(new URL(match[1], document.baseURI).href);
          }
        }
        return [...urls];
      })) as string[];

    // Many modern sites keep analytics and streaming requests open indefinitely, so
    // wait for DOM readiness and then allow client-rendered images a short settle period.
    console.log(`\nNavigating to ${targetUrl}...`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000, // Extended timeout for reliable page loading.
    });
    await page.waitForTimeout(3000);

    console.log("Extracting image URLs from page...");
    const { data: extractedUrls } = await stagehand.extract(
      "Extract the absolute HTTP(S) source URLs of all rendered images on this page, including image src attributes and background-image URLs. Return each URL exactly as rendered and preserve every hostname character, including any www prefix.",
      z.object({
        urls: z
          .array(z.string())
          .describe("Absolute HTTP(S) image resource URLs from src or background-image values"),
      }),
    );
    let allUrls = extractedUrls.urls.filter((url) => /^https?:\/\//i.test(url));
    if (allUrls.length === 0) {
      // Accessibility snapshots can omit decorative images. Use the exact DOM
      // shape only when semantic extraction returns no candidates at all.
      allUrls = await exactDomImageUrls();
    }

    // Extract only absolute image resource URLs, then deduplicate before applying the limit.
    const normalizedUrls = allUrls.flatMap((url) => {
      try {
        return [new URL(url).href];
      } catch {
        return [];
      }
    });
    const uniqueUrls = [...new Set(normalizedUrls)].filter((url) => {
      const { protocol } = new URL(url);
      return protocol === "https:" || protocol === "http:";
    });
    console.log(`Found ${uniqueUrls.length} unique image URL(s)`);

    const urls = uniqueUrls.slice(0, MAX_IMAGES);
    if (uniqueUrls.length > MAX_IMAGES) {
      console.log(`Capping at ${MAX_IMAGES} (adjust MAX_IMAGES to change this)`);
    }

    // Create a subdirectory scoped to the target site's hostname (e.g. images/browserbase.com/).
    const hostname = new URL(targetUrl).hostname;
    const outputDir = path.join(OUTPUT_DIR, hostname);
    fs.mkdirSync(outputDir, { recursive: true });

    let saved = 0;
    let failed = 0;

    const downloadImages = async (candidateUrls: string[]): Promise<void> => {
      for (let i = 0; i < candidateUrls.length; i++) {
        const url = candidateUrls[i];
        process.stdout.write(`[${i + 1}/${candidateUrls.length}] ${url} → `);

        let buffer: Buffer | null = null;
        let mimeType = "";
        try {
          const response = await bb.fetchAPI.create({
            url,
            format: "raw",
            allowRedirects: true,
          });
          mimeType = response.contentType.split(";", 1)[0];
          if (
            response.statusCode >= 200 &&
            response.statusCode < 300 &&
            mimeType.startsWith("image/") &&
            typeof response.content === "string"
          ) {
            buffer = Buffer.from(
              response.content,
              response.encoding === "base64" ? "base64" : "utf8",
            );
          }
        } catch {
          // The common failure path below records this URL as skipped.
        }

        if (!buffer) {
          console.log("FAILED (skipping)");
          failed++;
          continue;
        }

        const filename = imageFilename(url, mimeType, i);
        const filepath = path.join(outputDir, filename);
        try {
          fs.writeFileSync(filepath, buffer);
        } catch (err) {
          console.log(
            `FAILED (write error: ${err instanceof Error ? err.message : err}, skipping)`,
          );
          failed++;
          continue;
        }
        console.log(`saved as ${filename} (${buffer.length} bytes)`);
        saved++;
      }
    };

    console.log(`\nDownloading ${urls.length} image(s) via the Browserbase Fetch API...\n`);
    await downloadImages(urls);
    if (saved === 0 && uniqueUrls.length > 0) {
      // If semantic extraction produced URLs that cannot be fetched, fall back to
      // exact DOM mechanics without changing the semantic-first discovery path.
      const fallbackUrls = (await exactDomImageUrls())
        .filter((url) => !uniqueUrls.includes(url))
        .slice(0, MAX_IMAGES);
      await downloadImages(fallbackUrls);
    }

    console.log(`\nDone! ${saved} saved, ${failed} failed → ${outputDir}/`);
  } catch (error) {
    console.error("Error during image download:", error);
    throw error;
  } finally {
    // Always close session to release resources and clean up.
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
    console.log("Session closed successfully");
  }
}

main().catch((err) => {
  console.error("Error:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error("  - Verify the target URL is accessible");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});

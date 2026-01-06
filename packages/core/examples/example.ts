import * as fs from "node:fs";
import { Stagehand } from "../lib/v3";
import { v3Logger } from "../lib/v3/logger";
import { z } from "zod";

const scrapeSchema = z.object({
  companies: z.array(
    z.object({
      company: z.string(),
      batch: z.number(),
    }),
  ),
});

type Companies = z.infer<typeof scrapeSchema>;

async function scrapeCompanies(stagehand: Stagehand): Promise<Companies> {
  const page = stagehand.context.pages()[0];
  v3Logger({
    level: 1,
    category: "scrape-demo",
    message: `Navigating to aigrant.com ...`,
  });
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
    {
      waitUntil: "load",
    },
  );

  v3Logger({
    level: 1,
    category: "scrape-demo",
    message: `Navigation complete. Starting scrape ...`,
  });

  const companies = await stagehand.scrape(
    "Extract all companies that received the AI grant and group them with their batch numbers.",
    scrapeSchema,
  );

  const resolved = await companies.resolve();
  fs.writeFileSync("resolvedScrape.json", JSON.stringify(resolved, null, 2));

  console.log(JSON.stringify(resolved, null, 2));

  return resolved;
}

async function runScrape(runNumber: number) {
  const startTime = Date.now();

  v3Logger({
    level: 1,
    category: "scrape-demo",
    message: `RUN ${runNumber}: ${runNumber === 1 ? "BUILDING CACHE" : "USING CACHE"}`,
  });

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    model: "anthropic/claude-haiku-4-5",
    logInferenceToFile: true,
    cacheDir: "scrape-cache-2",
  });

  await stagehand.init();
  const resolvedListings = await scrapeCompanies(stagehand);
  const metrics = await stagehand.metrics;
  await stagehand.close();

  const duration = (Date.now() - startTime) / 1000;
  const listingCount = resolvedListings.companies.length;

  v3Logger({
    level: 1,
    category: "scrape-demo",
    message: `Run ${runNumber} finished in ${duration.toFixed(2)}s • Listings: ${listingCount}`,
  });

  v3Logger({
    level: 1,
    category: "scrape-demo",
    message: `Run ${runNumber} used ${metrics.totalPromptTokens} prompt tokens, & ${metrics.totalCompletionTokens} completion tokens`,
  });

  return {
    duration,
    listingCount,
    metrics,
  };
}

async function main() {
  const firstRun = await runScrape(1);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 5; i > 0; i--) {
    v3Logger({
      level: 1,
      category: "scrape-demo",
      message: `⏳ Starting scrape with cached xpaths in ${i}...`,
    });

    await delay(1000);
  }

  v3Logger({
    level: 1,
    category: "scrape-demo",
    message: "Starting second run with cache...",
  });
  const secondRun = await runScrape(2);

  const speedGain = (
    (1 - secondRun.duration / firstRun.duration) *
    100
  ).toFixed(1);
  const timeSaved = (firstRun.duration - secondRun.duration).toFixed(2);

  v3Logger({
    level: 1,
    category: "scrape-demo",
    message: `
╔══════════════════════════════════════════════╗
║            SCRAPE CACHE COMPARISON           ║
╚══════════════════════════════════════════════╝

┌─────────────────────┬──────────────────┬──────────────────┐
│     Metric          │   Run 1 (Cold)   │  Run 2 (Cached)  │
├─────────────────────┼──────────────────┼──────────────────┤
│ Duration            │ ${firstRun.duration.toFixed(2).padEnd(16)} │ ${secondRun.duration
      .toFixed(2)
      .padEnd(16)} │
│ Listings scraped    │ ${String(firstRun.listingCount).padEnd(16)} │ ${String(secondRun.listingCount).padEnd(16)} │
└─────────────────────┴──────────────────┴──────────────────┘

 Performance Comparison:
   • Speed: ${speedGain}% faster with cache
   • Time saved: ${timeSaved} seconds
   • Cache dir: scrape-cache-2
`,
  });
}

main().catch(console.error);

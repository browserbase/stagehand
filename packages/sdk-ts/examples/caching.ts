import "dotenv/config";
import { z } from "zod/v4";
import type { StagehandResultMetadata } from "../../protocol/types.js";
import { Stagehand } from "../src/index.js";

const { BROWSERBASE_API_KEY, OPENAI_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY || !OPENAI_API_KEY) throw new Error();

// Server-side caching requires a Browserbase browser session.
const stagehand = new Stagehand({
  apiKey: BROWSERBASE_API_KEY,
  browser: {
    type: "browserbase",
  },
  model: {
    modelName: "openai/gpt-5.4-mini",
    apiKey: OPENAI_API_KEY,
  },
});

const companiesSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
    }),
  ),
});

try {
  await stagehand.init();

  const page = await stagehand.context.activePage();
  if (!page) {
    throw new Error("Stagehand initialized without an active page");
  }
  await page.goto("https://aigrant.com");

  // With a threshold of 1, a single identical result is enough for the cache
  // to start serving hits, so the second call below is served from the cache.
  const extractCompanies = async () => {
    const start = performance.now();
    const result = await stagehand.extract(
      "Extract the names and descriptions of the first five companies listed on the page",
      companiesSchema,
      { page, cache: { threshold: 1 } },
    );
    return { result, durationMs: Math.round(performance.now() - start) };
  };

  // A miss reports why it missed; a hit reports how established the entry is
  // and the LLM tokens it saved.
  const reportCache = ({ metadata }: { metadata: StagehandResultMetadata }) => {
    console.log(`Cache status: ${metadata.cacheStatus ?? "disabled"}`);
    if (metadata.cacheMetadata) {
      console.log(`Cache details: ${JSON.stringify(metadata.cacheMetadata)}`);
    }
  };

  const first = await extractCompanies();
  console.log(`First extraction (expected cache miss, ${first.durationMs}ms):`);
  console.log(JSON.stringify(first.result.data, null, 2));
  reportCache(first.result);

  const second = await extractCompanies();
  console.log(`Second extraction (expected cache hit, ${second.durationMs}ms):`);
  console.log(JSON.stringify(second.result.data, null, 2));
  reportCache(second.result);
} finally {
  await stagehand.close();
}

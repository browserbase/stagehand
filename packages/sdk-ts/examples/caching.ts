import "dotenv/config";
import { z } from "zod/v4";
import type { StagehandResultMetadata } from "@browserbasehq/stagehand-protocol/types";
import { browserbase, Stagehand } from "../src/index.js";

const { BROWSERBASE_API_KEY, OPENAI_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY || !OPENAI_API_KEY) throw new Error();

const browser = await browserbase.launch({
  apiKey: BROWSERBASE_API_KEY,
});

const companiesSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
    }),
  ),
});

const stagehand = await Stagehand.create({
  browser,
  model: {
    modelName: "openai/gpt-5.4-mini",
    apiKey: OPENAI_API_KEY,
  },
});

const [page] = await browser.context.pages();
await page.goto("https://aigrant.com");

const extractCompanies = async () => {
  const start = performance.now();
  const result = await stagehand.extract(
    "Extract the names and descriptions of the first five companies listed on the page",
    companiesSchema,
    { page, cache: { threshold: 1 } },
  );
  return { result, durationMs: Math.round(performance.now() - start) };
};

const reportCache = ({ metadata }: { metadata: StagehandResultMetadata }) => {
  console.log(`Cache: ${JSON.stringify(metadata.cache ?? "disabled")}`);
};

const first = await extractCompanies();
console.log(`First extraction (expected cache miss, ${first.durationMs}ms):`);
console.log(JSON.stringify(first.result.data, null, 2));
reportCache(first.result);

const second = await extractCompanies();
console.log(`Second extraction (expected cache hit, ${second.durationMs}ms):`);
console.log(JSON.stringify(second.result.data, null, 2));
reportCache(second.result);

await stagehand.close();
await browser.close();

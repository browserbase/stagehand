import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod/v4";

const bookSchema = z.object({
  title: z.string().min(1),
  price: z.string().min(1),
  availability: z.string().min(1),
});
const pageSchema = z.object({ books: z.array(bookSchema).min(1) });
const apiKey = process.env.BROWSERBASE_API_KEY;
if (!apiKey) throw new Error("BROWSERBASE_API_KEY is required");
const gateway = process.env.MODEL_PROVIDER === "gateway";
if (process.env.MODEL_PROVIDER && !gateway)
  throw new Error("MODEL_PROVIDER must be gateway or unset");
const openaiKey = process.env.OPENAI_API_KEY;
if (!gateway && !openaiKey)
  throw new Error("OPENAI_API_KEY is required unless MODEL_PROVIDER=gateway");
const maxPages = Number(process.env.MAX_PAGES ?? "50");
if (!Number.isSafeInteger(maxPages) || maxPages < 1)
  throw new Error("MAX_PAGES must be a positive integer");
const catalogUrl = process.env.CATALOG_URL ?? "https://books.toscrape.com/";
const browser = await browserbase.launch({ apiKey });
try {
  const stagehand = await Stagehand.create({
    browser,
    ...(gateway ? {} : { model: { modelName: "openai/gpt-5.4-mini", apiKey: openaiKey } }),
  });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    await page.goto(catalogUrl);
    const visited = new Set<string>();
    const books: z.infer<typeof bookSchema>[] = [];
    for (let index = 0; index < maxPages; index++) {
      const url = await page.url();
      if (visited.has(url)) throw new Error(`Pagination cycle at ${url}`);
      visited.add(url);
      const result = await stagehand.extract(
        "Extract every book in the product grid, including title, displayed price, and availability.",
        pageSchema,
        { page },
      );
      books.push(...pageSchema.parse(result.data).books);
      const next = (
        await stagehand.observe(
          "Find the enabled Next pagination link. Return no actions if there is no next page.",
          { page },
        )
      ).data[0];
      if (!next) {
        await mkdir("out", { recursive: true });
        await writeFile(
          "out/catalog.json",
          `${JSON.stringify({ pages: visited.size, count: books.length, books }, null, 2)}\n`,
        );
        console.log(`Saved ${books.length} books from ${visited.size} pages to out/catalog.json`);
        break;
      }
      if (index + 1 === maxPages)
        throw new Error(`MAX_PAGES=${maxPages} reached before the final page`);
      const acted = await stagehand.act(next, { page });
      if (!acted.data.success) throw new Error(`Next-page act failed: ${acted.data.message}`);
      await page.waitForLoadState("domcontentloaded");
      if ((await page.url()) === url)
        throw new Error(`Next-page action did not navigate from ${url}`);
    }
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}

import "dotenv/config";
import { downloadCover } from "./download.js";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { Files } from "files-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";

const catalogSchema = z.object({
  books: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        price: z.string().trim().min(1),
      }),
    )
    .min(1),
});

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
if (!browserbaseApiKey) {
  throw new Error("BROWSERBASE_API_KEY is required");
}
const browser = await browserbase.launch({ apiKey: browserbaseApiKey, api_timeout: 300 });

try {
  console.log(`Session: https://www.browserbase.com/sessions/${browser.sessionId}`);
  const stagehand = await Stagehand.create({
    browser,
    ...(openaiApiKey ? { model: { modelName: "openai/gpt-5.4-mini", apiKey: openaiApiKey } } : {}),
  });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    await page.goto("https://books.toscrape.com/");

    const extracted = await stagehand.extract(
      "Extract each book on this page: title and displayed price.",
      catalogSchema,
      { page },
    );

    const coverUrl = await page.evaluate(
      () => document.querySelector<HTMLImageElement>("article.product_pod img")?.src,
    );
    if (!coverUrl) throw new Error("No cover image exists in the product grid");
    const validated = { ...catalogSchema.parse(extracted.data), coverUrl };
    const outDir = join(process.cwd(), "out");
    await mkdir(outDir, { recursive: true });
    const catalogJson = `${JSON.stringify(validated, null, 2)}\n`;
    const catalogPath = join(outDir, "catalog.json");
    await writeFile(catalogPath, catalogJson);

    const imageUrl = new URL(coverUrl);
    const imageBytes = await downloadCover(imageUrl);
    const coverPath = join(outDir, "cover.jpg");
    await writeFile(coverPath, imageBytes);

    console.log(`Wrote ${catalogPath} and ${coverPath}`);

    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      console.log("S3_BUCKET is unset; skipped upload. Set it to push these files to a bucket.");
    } else {
      const { s3 } = await import("files-sdk/s3");
      const files = new Files({
        adapter: s3({
          bucket,
          region: process.env.AWS_REGION ?? "us-east-1",
          ...(process.env.S3_ENDPOINT
            ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
            : {}),
        }),
      });
      const prefix = process.env.S3_PREFIX ?? "stagehand-cookbooks/files-to-bucket";
      await files.upload(`${prefix}/catalog.json`, catalogJson, {
        contentType: "application/json",
      });
      await files.upload(`${prefix}/cover.jpg`, imageBytes, {
        contentType: "image/jpeg",
      });
      console.log(`Uploaded ${prefix}/catalog.json and cover.jpg to ${bucket}`);
    }
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}

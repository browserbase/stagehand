import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";

const catalogSchema = z.object({
  books: z
    .array(
      z.object({
        title: z.string(),
        price: z.string(),
        imageUrl: z.string(),
      }),
    )
    .min(1),
});

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
if (!browserbaseApiKey || !openaiApiKey) {
  throw new Error("BROWSERBASE_API_KEY and OPENAI_API_KEY are required");
}
const browser = await browserbase.launch({ apiKey: browserbaseApiKey });

try {
  const stagehand = await Stagehand.create({
    browser,
    model: { modelName: "openai/gpt-5.4-mini", apiKey: openaiApiKey },
  });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    await page.goto("https://books.toscrape.com/");

    const extracted = await stagehand.extract(
      "Extract each book on this page: title, displayed price, and cover image URL.",
      catalogSchema,
      { page },
    );

    const validated = catalogSchema.parse(extracted.data);
    const outDir = join(process.cwd(), "out");
    await mkdir(outDir, { recursive: true });
    const catalogJson = `${JSON.stringify(validated, null, 2)}\n`;
    const catalogPath = join(outDir, "catalog.json");
    await writeFile(catalogPath, catalogJson);

    const imageUrl = new URL(validated.books[0].imageUrl, await page.url()).href;
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Cover download failed: ${imageResponse.status} ${imageUrl}`);
    }
    const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (imageBytes.length === 0) throw new Error("Cover download returned no bytes");
    const coverPath = join(outDir, "cover.jpg");
    await writeFile(coverPath, imageBytes);

    console.log(`Wrote ${catalogPath} and ${coverPath}`);

    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      console.log("S3_BUCKET is unset; skipped upload. Set it to push these files to a bucket.");
    } else {
      const files = new Files({
        adapter: s3({
          bucket,
          region: process.env.AWS_REGION ?? "us-east-1",
          ...(process.env.S3_ENDPOINT
            ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
            : {}),
        }),
      });
      const prefix = process.env.S3_PREFIX ?? "stagehand-examples/files-to-bucket";
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

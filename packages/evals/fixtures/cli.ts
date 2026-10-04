import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { writeObservationFixture } from "./record.js";

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      out: { type: "string" },
      setup: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "fixture:record --url <http(s) URL> --out <new directory> [--setup <module.ts>]\nThe setup module must default-export an async function(page: Page). It runs trusted local code before capture.",
    );
    return;
  }
  if (!values.url || !values.out || !["http:", "https:"].includes(new URL(values.url).protocol)) {
    throw new Error("Provide --url <http(s) URL> and --out <new directory>");
  }
  const setup = values.setup
    ? (await import(pathToFileURL(resolve(values.setup)).href)).default
    : undefined;
  if (values.setup && typeof setup !== "function") {
    throw new Error("Setup module must default-export a function(page: Page)");
  }
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(values.url, { waitUntil: "load" });
    if (setup) await (setup as (page: Page) => Promise<void>)(page);
    await writeObservationFixture(page, values.out);
    console.log(`Recorded observation fixture in ${resolve(values.out)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

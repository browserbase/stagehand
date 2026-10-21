import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { recordNetwork, writeNetworkTask } from "./network.js";
import { writeObservationTask } from "./record.js";

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      out: { type: "string" },
      setup: { type: "string" },
      network: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "task:record --url <http(s) URL> --out <new directory> [--setup <module.ts>] [--network]\nThe setup module must default-export an async function(page: Page). It runs trusted local code before capture.\n--network records the responses the page receives (responses.json) for replay, instead of a static observation.",
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
    const recorder = values.network ? await recordNetwork(page) : undefined;
    await page.goto(values.url, { waitUntil: "load" });
    if (setup) await (setup as (page: Page) => Promise<void>)(page);
    if (recorder) {
      const recording = await recorder.stop();
      await writeNetworkTask(recording, values.out, {
        sourceUrl: values.url,
        viewport: page.viewportSize(),
      });
      console.log(
        `Recorded network task (${recording.responses.length} responses) in ${resolve(values.out)}`,
      );
    } else {
      await writeObservationTask(page, values.out);
      console.log(`Recorded observation task in ${resolve(values.out)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

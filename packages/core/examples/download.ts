import { Stagehand } from "@browserbasehq/stagehand";
import { Browserbase } from "@browserbasehq/sdk";
import type { Download } from "playwright";
import JSZip from "jszip";

export function attachDownloadLogger(
  stagehand: Stagehand,
  browserbase: Browserbase,
): void {
  const { page } = stagehand;
  const sessionId = stagehand.browserbaseSessionID;

  if (!sessionId) {
    stagehand.logger({
      category: "download",
      message: "No Browserbase session – skipping download logger.",
      level: 0,
    });
    return;
  }

  page.on("download", async (dl: Download) => {
    stagehand.logger({
      category: "download",
      message: "Download started",
      level: 1,
      auxiliary: {
        url: { value: dl.url(), type: "string" },
        filename: { value: dl.suggestedFilename(), type: "string" },
      },
    });

    // await new Promise((resolve) => setTimeout(resolve, 20_000));
    let failure: string | undefined;
    try {
      failure = await dl.failure();
    } catch (err) {
      failure = `Error while checking download failure: ${err instanceof Error ? err.stack || err.message : String(err)}`;
      stagehand.logger({
        category: "download",
        message: "Exception thrown during dl.failure()",
        level: 0,
        auxiliary: {
          error: { value: failure, type: "string" },
        },
      });
    }
    if (failure) {
      stagehand.logger({
        category: "download",
        message: "Download failed",
        level: 0,
        auxiliary: {
          error: { value: failure, type: "string" },
        },
      });
    }

    /* fetch the ZIP archive from Browserbase */
    const resp = await browserbase.sessions.downloads.list(sessionId);
    const zipBuf = await resp.arrayBuffer(); // application/zip

    /* inspect the archive with JSZip */
    const zip = await JSZip.loadAsync(zipBuf);
    const names = Object.keys(zip.files);

    stagehand.logger({
      category: "download",
      message: `Browserbase archive contains ${names.length} file(s)`,
      level: 1,
      auxiliary: {
        files: { value: JSON.stringify(names, null, 2), type: "object" },
      },
    });

    // Write the first PDF file in the archive to disk
    const pdfFileName = names.find((name) => name.endsWith(".pdf"));
    if (pdfFileName) {
      const pdfData = await zip.files[pdfFileName].async("nodebuffer");
      const fs = await import("fs/promises");
      await fs.writeFile(pdfFileName, pdfData);
      stagehand.logger({
        category: "download",
        message: `PDF file written to disk: ${pdfFileName}`,
        level: 1,
      });
    } else {
      stagehand.logger({
        category: "download",
        message: "No PDF file found in the archive.",
        level: 0,
      });
    }
  });
}

async function example(stagehand: Stagehand): Promise<void> {
  const page = stagehand.page;

  stagehand.agent({
    provider: "openai",
    // For Anthropic, use claude-sonnet-4-20250514 or claude-3-7-sonnet-latest
    model: "computer-use-preview",
    instructions: `You are a helpful assistant that can use a web browser.
    You are currently on the following page: ${page.url()}.
    Do not ask follow up questions, the user will trust your judgement.`,
    options: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  // await page.goto(
  //   "https://billofrightsinstitute.org/primary-sources/declaration-of-independence?gad_source=1&gad_campaignid=1461766925&gbraid=0AAAAAD-kVKqmqLRPIf5w6JtUk-Z_mf-wm&gclid=CjwKCAjw-svEBhB6EiwAEzSdrmgE_lM999n7bYMSSXdCuuKXaCIbLK-vDg-mJ03StSdJbcuXAGAN6hoCauEQAvD_BwE",
  // );
  // await agent.execute({
  //   instruction: "Close the popup and then click the download button",
  //   maxSteps: 20,
  // });

  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/download-on-click/",
  );

  await page.act("click the download file button");
}

(async () => {
  const browserbase = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY ?? "",
  });

  const stagehand = new Stagehand({
    env: "LOCAL",
    // env: "BROWSERBASE",
    verbose: 1,
    // useAPI: true,
  });

  await stagehand.init();
  attachDownloadLogger(stagehand, browserbase);

  await example(stagehand);
})();

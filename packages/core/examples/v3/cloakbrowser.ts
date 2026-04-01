import { Stagehand } from "../../lib/v3/index.js";
import { ensureBinary, getDefaultStealthArgs } from "cloakbrowser";
import { z } from "zod";

// CloakBrowser is a stealth Chromium binary with source-level C++ fingerprint patches.
// It passes Cloudflare, reCAPTCHA, and other bot detection without JS-level overrides.
// Install: npm install cloakbrowser (binary auto-downloads on first run)
// https://github.com/CloakHQ/CloakBrowser

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto("https://news.ycombinator.com");

  const headlines = await stagehand.extract(
    "extract the top 5 headlines from Hacker News",
    z.array(z.string()),
  );
  console.log(headlines);
}

(async () => {
  const binaryPath = await ensureBinary();
  const stealthArgs = getDefaultStealthArgs();

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    model: "openai/gpt-4.1",
    localBrowserLaunchOptions: {
      executablePath: binaryPath,
      args: stealthArgs,
      headless: false,
    },
  });
  await stagehand.init();
  await example(stagehand);
  await stagehand.close();
})();

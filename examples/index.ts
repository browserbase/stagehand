#!/usr/bin/env -S pnpm tsx
import { Stagehand } from '../lib';
import { z } from 'zod';

async function example() {
  const stagehand = new Stagehand({ env: 'LOCAL', verbose: true });
  await stagehand.init();
  await stagehand.page.goto('https://google.com');
  await stagehand.act({
    action: 'run search for "ai drones crs reports filetype:pdf"',
  });

  const urlSchema = z.object({
    urls: z.array(
      z.object({
        url: z.string().url(),
        title: z.string(),
      })
    ),
  });
  const result = await stagehand.extract({
    instruction: 'get the URLS of 5 pdfs that are related to AI',
    schema: urlSchema,
  });
  const urls = result.urls;
  for (const response of urls) {
    await stagehand.downloadPDF(response.url, response.title);
  }
}

async function debug() {
  const stagehand = new Stagehand({ env: 'LOCAL', verbose: true });
  await stagehand.init();
  await stagehand.page.goto('https://chefstoys.com/');
  await stagehand.act({
    action: 'run a search for peelers',
  });
  await new Promise((resolve) => setTimeout(resolve, 30000));
}

(async () => {
  await debug();
})();

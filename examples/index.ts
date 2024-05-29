#!/usr/bin/env -S pnpm tsx
import { Stagehand } from '../lib/playwright';
import { z } from 'zod';

async function example() {
  const stagehand = new Stagehand({ env: 'LOCAL' });
  await stagehand.init();
  await stagehand.page.goto('https://google.com');
  await stagehand.act({
    action: 'search for "ai drones crs reports filetype:pdf"',
  });
  await stagehand.act({
    action: 'submit the search from',
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

(async () => {
  await example();
})();

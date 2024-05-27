#!/usr/bin/env -S pnpm tsx
import { Stagehand } from '../lib/playwright';
import { z } from 'zod';

async function example() {
  const stageHand = new Stagehand({ env: 'LOCAL' });
  await stageHand.init();
  await stageHand.page.goto('https://google.com');
  await stageHand.act({
    action: 'search for "ai drones crs reports filetype:pdf"',
  });
  await stageHand.act({
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
  const result = await stageHand.extract({
    instruction: 'get the URLS of 5 pdfs that are related to AI',
    schema: urlSchema,
  });
  const urls = result.urls;
  for (const response of urls) {
    await stageHand.downloadPDF(response.url, response.title);
  }
}

(async () => {
  await example();
})();

import { defineTool } from "eve/tools";
import { z } from "zod";

import { stagehandSession } from "../lib/session.js";

export default defineTool({
  description:
    "Return the accessibility snapshot for the active Stagehand page. Snapshot IDs describe elements but are not selectors for run code.",
  inputSchema: z.object({
    includeIframes: z.boolean().default(true),
  }),
  async execute({ includeIframes }) {
    return stagehandSession.run(async ({ browser }) => {
      const page = (await browser.context.activePage()) ?? (await browser.context.newPage());
      const snapshot = await page.snapshot({ includeIframes });
      return snapshot.formattedTree;
    });
  },
});

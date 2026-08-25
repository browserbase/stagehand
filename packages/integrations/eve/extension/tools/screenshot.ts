import { defineTool } from "eve/tools";
import { z } from "zod";

import { stagehandSession } from "../lib/session.js";

export default defineTool({
  description: "Capture a screenshot of the active Stagehand page.",
  inputSchema: z.object({
    fullPage: z.boolean().default(false),
    type: z.enum(["png", "jpeg"]).default("png"),
    quality: z.number().int().min(0).max(100).optional(),
  }),
  async execute({ fullPage, type, quality }) {
    return stagehandSession.run(async ({ browser }) => {
      const page = (await browser.context.activePage()) ?? (await browser.context.newPage());
      const options: Parameters<typeof page.screenshot>[0] = { fullPage, type };
      if (type === "jpeg" && quality !== undefined) options.quality = quality;
      const bytes = await page.screenshot(options);
      return {
        data: Buffer.from(bytes).toString("base64"),
        mimeType: type === "jpeg" ? "image/jpeg" : "image/png",
      };
    });
  },
  toModelOutput({ data, mimeType }) {
    return {
      type: "content",
      value: [
        { type: "text", text: "Screenshot captured." },
        { type: "file", data: { type: "data", data }, mediaType: mimeType },
      ],
    };
  },
});

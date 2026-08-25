import { defineTool } from "eve/tools";
import { z } from "zod";

import { runStagehandCode } from "../lib/run.js";

export default defineTool({
  description:
    "Run JavaScript against the active Stagehand v4 page. Code can use page, context, act, observe, extract, and close, must await async methods, and must return its result. The page supports Stagehand's documented Page and Locator methods, not Playwright-only helpers.",
  inputSchema: z.object({
    code: z.string().min(1),
  }),
  async execute({ code }) {
    return runStagehandCode(code);
  },
});

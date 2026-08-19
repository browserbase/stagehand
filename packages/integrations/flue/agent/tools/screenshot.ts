import { defineTool } from "@flue/runtime";
import * as v from "valibot";

import {
  SCREENSHOT_TOOL_DESCRIPTION,
  ScreenshotInputSchema,
} from "@browserbasehq/stagehand-integrations/facade";

import { writeScreenshotArtifact } from "../../src/artifacts.js";
import { discardFacadeToolsIfUnhealthy, getFacadeTools } from "../../src/session.js";

export default defineTool({
  name: "screenshot",
  description: SCREENSHOT_TOOL_DESCRIPTION,
  input: v.object({
    fullPage: v.optional(v.boolean()),
    type: v.optional(v.picklist(["png", "jpeg"])),
    quality: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100))),
  }),
  async run({ data }) {
    const input = ScreenshotInputSchema.parse(data);
    const tools = await getFacadeTools();
    try {
      const image = await tools.screenshot(input);
      return { output: await writeScreenshotArtifact(image) };
    } catch (error) {
      await discardFacadeToolsIfUnhealthy(tools);
      throw error;
    }
  },
});

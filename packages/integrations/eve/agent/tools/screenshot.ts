import {
  SCREENSHOT_INPUT_SCHEMA,
  SCREENSHOT_TOOL_DESCRIPTION,
  ScreenshotInputSchema,
} from "@browserbasehq/stagehand-integrations/facade";
import { defineTool } from "eve/tools";

import { discardFacadeToolsIfUnhealthy, getFacadeTools } from "../../src/session.js";

export default defineTool({
  description: SCREENSHOT_TOOL_DESCRIPTION,
  inputSchema: SCREENSHOT_INPUT_SCHEMA,
  async execute(rawInput) {
    const input = ScreenshotInputSchema.parse(rawInput);
    const tools = await getFacadeTools();
    try {
      return await tools.screenshot(input);
    } catch (error) {
      await discardFacadeToolsIfUnhealthy(tools);
      throw error;
    }
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

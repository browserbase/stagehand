import { defineTool } from "eve/tools";

import {
  SCREENSHOT_INPUT_SCHEMA,
  SCREENSHOT_TOOL_DESCRIPTION,
  ScreenshotInputSchema,
} from "../lib/core-facade/contract.js";
import { stagehandSession } from "../lib/session.js";

export default defineTool({
  description: SCREENSHOT_TOOL_DESCRIPTION,
  inputSchema: SCREENSHOT_INPUT_SCHEMA,
  async execute(rawInput) {
    const input = ScreenshotInputSchema.parse(rawInput);
    return stagehandSession.run(({ tools }) => tools.screenshot(input));
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

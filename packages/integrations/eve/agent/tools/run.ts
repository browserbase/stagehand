import {
  CodeModeRunInputSchema,
  RUN_INPUT_SCHEMA,
  RUN_TOOL_DESCRIPTION,
} from "@browserbasehq/stagehand-integrations/facade";
import { defineTool } from "eve/tools";

import { discardFacadeToolsIfUnhealthy, getFacadeTools } from "../../src/session.js";

export default defineTool({
  description: RUN_TOOL_DESCRIPTION,
  inputSchema: RUN_INPUT_SCHEMA,
  async execute(rawInput) {
    const input = CodeModeRunInputSchema.parse(rawInput);
    const tools = await getFacadeTools();
    try {
      const result =
        input.code !== undefined
          ? await tools.run(input.code)
          : await tools.runActions(input.actions!);
      return stringifyResult(result);
    } catch (error) {
      await discardFacadeToolsIfUnhealthy(tools);
      throw error;
    }
  },
});

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

import { defineTool } from "eve/tools";

import {
  CodeModeRunInputSchema,
  RUN_INPUT_SCHEMA,
  RUN_TOOL_DESCRIPTION,
} from "../lib/core-facade/contract.js";
import { stagehandSession } from "../lib/session.js";

export default defineTool({
  description: RUN_TOOL_DESCRIPTION,
  inputSchema: RUN_INPUT_SCHEMA,
  async execute(rawInput) {
    const input = CodeModeRunInputSchema.parse(rawInput);
    return stagehandSession.run(async ({ tools }) => {
      const result =
        input.code !== undefined
          ? await tools.run(input.code)
          : await tools.runActions(input.actions!);
      return stringifyResult(result);
    });
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

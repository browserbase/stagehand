import { defineTool } from "@flue/runtime";
import * as v from "valibot";

import {
  CodeModeRunInputSchema,
  RUN_TOOL_DESCRIPTION,
} from "@browserbasehq/stagehand-integrations/facade";

import { discardFacadeToolsIfUnhealthy, getFacadeTools } from "../../src/session.js";

const runInput = v.object({
  code: v.optional(v.pipe(v.string(), v.minLength(1))),
  actions: v.optional(v.pipe(v.array(v.record(v.string(), v.unknown())), v.minLength(1))),
});

export default defineTool({
  name: "run",
  description: RUN_TOOL_DESCRIPTION,
  input: runInput,
  async run({ data }) {
    const input = CodeModeRunInputSchema.parse(data);
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

import { defineTool } from "@flue/runtime";
import * as v from "valibot";

import {
  SNAPSHOT_TOOL_DESCRIPTION,
  SnapshotInputSchema,
} from "@browserbasehq/stagehand-integrations/facade";

import { discardFacadeToolsIfUnhealthy, getFacadeTools } from "../../src/session.js";

export default defineTool({
  name: "snapshot",
  description: SNAPSHOT_TOOL_DESCRIPTION,
  input: v.strictObject({
    includeIframes: v.optional(v.boolean()),
  }),
  async run({ data }) {
    const input = SnapshotInputSchema.parse(data);
    const tools = await getFacadeTools();
    try {
      return await tools.snapshot(input);
    } catch (error) {
      await discardFacadeToolsIfUnhealthy(tools);
      throw error;
    }
  },
});

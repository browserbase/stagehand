import {
  SNAPSHOT_INPUT_SCHEMA,
  SNAPSHOT_TOOL_DESCRIPTION,
  SnapshotInputSchema,
} from "@browserbasehq/stagehand-integrations/facade";
import { defineTool } from "eve/tools";

import { discardFacadeToolsIfUnhealthy, getFacadeTools } from "../../src/session.js";

export default defineTool({
  description: SNAPSHOT_TOOL_DESCRIPTION,
  inputSchema: SNAPSHOT_INPUT_SCHEMA,
  async execute(rawInput) {
    const input = SnapshotInputSchema.parse(rawInput);
    const tools = await getFacadeTools();
    try {
      return await tools.snapshot(input);
    } catch (error) {
      await discardFacadeToolsIfUnhealthy(tools);
      throw error;
    }
  },
});

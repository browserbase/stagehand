import { defineTool } from "eve/tools";

import {
  SNAPSHOT_INPUT_SCHEMA,
  SNAPSHOT_TOOL_DESCRIPTION,
  SnapshotInputSchema,
} from "../lib/core-facade/contract.js";
import { stagehandSession } from "../lib/session.js";

export default defineTool({
  description: SNAPSHOT_TOOL_DESCRIPTION,
  inputSchema: SNAPSHOT_INPUT_SCHEMA,
  async execute(rawInput) {
    const input = SnapshotInputSchema.parse(rawInput);
    return stagehandSession.run(({ tools }) => tools.snapshot(input));
  },
});

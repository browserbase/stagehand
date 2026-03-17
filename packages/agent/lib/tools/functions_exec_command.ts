import {
  ExecCommandArgsSchema,
  ExecCommandResultSchema,
} from "../protocol.js";
import { execProcessCommand } from "../state/process.js";
import type { ToolSpec } from "./types.js";

export const functions_exec_command = {
  name: "functions_exec_command",
  description:
    "Run a shell command inside the shared workspace. Long-running commands return a session_id for functions_write_stdin.",
  inputSchema: ExecCommandArgsSchema,
  outputSchema: ExecCommandResultSchema,
  execute: async (input, context) =>
    ExecCommandResultSchema.parse(
      await execProcessCommand(context.workspace, input),
    ),
} satisfies ToolSpec;

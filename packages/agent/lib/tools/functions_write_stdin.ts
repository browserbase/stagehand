import {
  WriteStdinArgsSchema,
  WriteStdinResultSchema,
} from "../protocol.js";
import { writeProcessStdin } from "../state/process.js";
import type { ToolSpec } from "./types.js";

export const functions_write_stdin = {
  name: "functions_write_stdin",
  description: "Write input to a previously started shell session.",
  inputSchema: WriteStdinArgsSchema,
  outputSchema: WriteStdinResultSchema,
  execute: async (input, context) =>
    WriteStdinResultSchema.parse(
      await writeProcessStdin(context.workspace, input),
    ),
} satisfies ToolSpec;

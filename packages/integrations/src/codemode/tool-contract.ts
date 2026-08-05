import { z } from "zod/v4";
import { STAGEHAND_CODEMODE_SKILL } from "./generated-content.js";
import type { CodeExecuteResult } from "./types.js";

export const CODE_EXECUTE_DESCRIPTION = [
  "Execute an async JavaScript function body against one long-lived Stagehand V4 browser.",
  "The executor lazily creates a local or Browserbase browser on the first call and reuses it for later calls.",
  "The executor itself is not a security sandbox. The owning framework may run it inside a sandbox or another isolation boundary.",
  "If execution stops responding, the owning framework should terminate and restart the local tool process.",
  "",
  STAGEHAND_CODEMODE_SKILL,
].join("\n");

export const codeExecuteSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(100_000)
    .describe(
      "Async JavaScript function body. page, context, stagehand, z, and console are in scope.",
    ),
});

export function codeExecuteResultText(result: CodeExecuteResult): string {
  return JSON.stringify(result, null, 2);
}

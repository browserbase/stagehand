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
    .refine((code) => code.trim().length > 0, "code must contain JavaScript source")
    .refine(
      (code) => new TextEncoder().encode(code).byteLength <= 100_000,
      "code must be at most 100000 UTF-8 bytes",
    )
    .describe(
      "Async JavaScript function body. page, context, stagehand, z, and console are in scope.",
    ),
});

export const codeExecuteOutputSchema = z.object({
  ok: z.boolean(),
  page: z
    .object({
      url: z.string(),
      title: z.string(),
    })
    .optional(),
  value: z.unknown().optional(),
  logs: z
    .array(
      z.object({
        level: z.enum(["log", "warn", "error"]),
        text: z.string(),
      }),
    )
    .optional(),
  error: z
    .object({
      kind: z.enum(["validation", "runtime", "aborted", "closed"]),
      name: z.string(),
      message: z.string(),
    })
    .optional(),
});

export function codeExecuteResultText(result: CodeExecuteResult): string {
  return JSON.stringify(result, null, 2);
}

import { z } from "zod/v4";
import { MAX_CODE_BYTES } from "./limits.js";
import type { CodeExecuteResult } from "./types.js";

export const CODE_EXECUTE_DESCRIPTION = [
  "Execute an async JavaScript function body against one long-lived Stagehand V4 browser.",
  "The executor lazily creates a local or Browserbase browser on the first call and reuses it for later calls.",
  "The executor itself is not a security sandbox. The owning framework may run it inside a sandbox or another isolation boundary.",
  "If execution stops responding, the owning framework should terminate and restart the local tool process.",
].join("\n");

export const codeExecuteSchema = z.object({
  code: z
    .string()
    .refine((code) => code.trim().length > 0, "code must contain JavaScript source")
    .refine(
      (code) => new TextEncoder().encode(code).byteLength <= MAX_CODE_BYTES,
      `code must be at most ${MAX_CODE_BYTES} UTF-8 bytes`,
    )
    .describe(
      "Async JavaScript function body. page, context, stagehand, z, and console are in scope.",
    ),
});

export const codeExecuteOutputSchema = z
  .object({
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
  })
  .superRefine((result, context) => {
    if (result.ok) {
      if (!result.page) {
        context.addIssue({ code: "custom", message: "successful results require page state" });
      }
      if (result.error) {
        context.addIssue({ code: "custom", message: "successful results cannot include an error" });
      }
      return;
    }

    if (!result.error) {
      context.addIssue({ code: "custom", message: "failed results require an error" });
    }
    if (result.value !== undefined) {
      context.addIssue({ code: "custom", message: "failed results cannot include a value" });
    }
  });

export function codeExecuteResultText(result: CodeExecuteResult): string {
  return JSON.stringify(result, null, 2);
}

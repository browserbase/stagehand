import { z } from "zod/v4";
import {
  ParallelArgsSchema,
  ToolNameSchema,
  WriteStdinArgsSchema,
} from "../protocol.js";
import type { AgentToolContext, ToolSpec } from "./types.js";

export const MULTI_TOOL_USE_PARALLEL_RESULT_SCHEMA = z.object({
  ok: z.boolean(),
  message: z.string().nullable().optional(),
  results: z.array(
    z.object({
      recipient_name: z.string(),
      ok: z.boolean(),
      output: z.unknown().optional(),
      error: z.string().optional(),
    }),
  ),
});

export const multi_tool_use_parallel = {
  name: "multi_tool_use_parallel",
  description:
    "Run disjoint safe-identifier tool calls in parallel through the same tool table.",
  inputSchema: ParallelArgsSchema,
  outputSchema: MULTI_TOOL_USE_PARALLEL_RESULT_SCHEMA,
  execute: async (
    input,
    context,
  ): Promise<z.infer<typeof MULTI_TOOL_USE_PARALLEL_RESULT_SCHEMA>> =>
    MULTI_TOOL_USE_PARALLEL_RESULT_SCHEMA.parse(
      await runParallelToolCalls(input, context),
    ),
} satisfies ToolSpec;

async function runParallelToolCalls(
  args: z.infer<typeof ParallelArgsSchema>,
  context: AgentToolContext,
): Promise<z.infer<typeof MULTI_TOOL_USE_PARALLEL_RESULT_SCHEMA>> {
  const validation = validateParallelCalls(args);
  if (!validation.ok) {
    return validation;
  }

  const results: z.infer<
    typeof MULTI_TOOL_USE_PARALLEL_RESULT_SCHEMA
  >["results"] = await Promise.all(
    args.tool_uses.map(async (toolUse) => {
      try {
        const { ALL_TOOLS } = await import("./index.js");
        const toolName = ToolNameSchema.parse(toolUse.recipient_name);
        const tool = ALL_TOOLS[toolName];
        const parsedInput = tool.inputSchema.parse(toolUse.parameters);
        return {
          recipient_name: toolUse.recipient_name,
          ok: true,
          output: tool.outputSchema.parse(
            await tool.execute(parsedInput, context),
          ),
        };
      } catch (error) {
        return {
          recipient_name: toolUse.recipient_name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return {
    ok: results.every((result: { ok: boolean }) => result.ok),
    results,
  };
}

function validateParallelCalls(args: z.infer<typeof ParallelArgsSchema>): {
  ok: boolean;
  message?: string;
  results: Array<{
    recipient_name: string;
    ok: boolean;
    output?: unknown;
    error?: string;
  }>;
} {
  const resourceClaims = new Map<string, string>();

  for (const toolUse of args.tool_uses) {
    const parsedToolName = ToolNameSchema.safeParse(toolUse.recipient_name);
    if (!parsedToolName.success) {
      return {
        ok: false,
        message: `multi_tool_use_parallel received an unknown tool identifier: ${toolUse.recipient_name}`,
        results: [],
      };
    }

    if (toolUse.recipient_name === "multi_tool_use_parallel") {
      return {
        ok: false,
        message: "multi_tool_use_parallel cannot invoke itself recursively.",
        results: [],
      };
    }

    const resourceKey = getExclusiveResourceKey(toolUse);
    if (!resourceKey) {
      continue;
    }

    const existing = resourceClaims.get(resourceKey);
    if (existing) {
      return {
        ok: false,
        message: `multi_tool_use_parallel received conflicting calls for ${resourceKey}: ${existing} and ${toolUse.recipient_name}`,
        results: [],
      };
    }
    resourceClaims.set(resourceKey, toolUse.recipient_name);
  }

  return { ok: true, results: [] };
}

function getExclusiveResourceKey(
  toolUse: z.infer<typeof ParallelArgsSchema>["tool_uses"][number],
) {
  switch (toolUse.recipient_name) {
    case "functions_write_stdin": {
      const parsed = WriteStdinArgsSchema.safeParse(toolUse.parameters);
      return parsed.success ? `process:${parsed.data.session_id}` : null;
    }
    case "functions_update_plan":
      return "plan";
    default:
      return null;
  }
}

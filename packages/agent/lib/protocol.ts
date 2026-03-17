import { z } from "zod/v4";
import { Api } from "@browserbasehq/stagehand";

export const DEFAULT_INITIAL_SUBAGENT_COUNT = 3;
export const DEFAULT_SUBAGENT_COUNT = DEFAULT_INITIAL_SUBAGENT_COUNT;

export const BrowserIdSchema = z.enum(["1", "2", "3"]).meta({
  id: "AgentBrowserId",
  description: "Stable browser slot identifier for the initial subagents.",
});

export type BrowserId = z.infer<typeof BrowserIdSchema>;
export const ManagedAgentIdSchema = z.string().min(1).meta({
  id: "ManagedAgentId",
  description:
    "Runtime-managed subagent identifier. The initial browser slots are '1', '2', and '3', while dynamically spawned agents use generated string ids.",
});

export type ManagedAgentId = z.infer<typeof ManagedAgentIdSchema>;

export const BrowserIds = BrowserIdSchema.options;

export const AgentStatusSchema = z
  .enum(["idle", "running", "paused"])
  .meta({ id: "AgentStatus" });

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const JsonObjectSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: "JsonObject" });

export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const ModelInputSchema = z
  .union([Api.ModelConfigSchema, z.string()])
  .meta({ id: "AgentModelInput" });

export type ModelInput = z.infer<typeof ModelInputSchema>;

const StagehandAgentConfigSubsetSchema = Api.AgentConfigSchema.pick({
  mode: true,
  model: true,
  executionModel: true,
  systemPrompt: true,
});

export const AgentSubagentConfigSchema = z
  .object({
    ...StagehandAgentConfigSubsetSchema.shape,
  })
  .meta({
    id: "AgentSubagentConfig",
    description:
      "Serializable configuration for one delegated browse subagent.",
  });

export type AgentSubagentConfig = z.infer<typeof AgentSubagentConfigSchema>;
export const SubagentConfigSchema = AgentSubagentConfigSchema;
export type SubagentConfig = AgentSubagentConfig;

export const AgentOptionsSchema = z
  .object({
    modelName: z.string(),
    clientOptions: JsonObjectSchema.optional(),
    workspace: z.string().optional(),
    systemPrompt: z.string().optional(),
    maxSteps: z.number().int().positive().optional(),
    subagents: z.array(AgentSubagentConfigSchema).optional(),
  })
  .meta({
    id: "AgentOptions",
    description:
      "Top-level agent options. The runtime normalizes this into a stable three-subagent workspace layout.",
  });

export type AgentOptions = z.infer<typeof AgentOptionsSchema>;

export const ToolNameSchema = z
  .enum([
    "functions_exec_command",
    "functions_write_stdin",
    "functions_update_plan",
    "functions_view_image_or_document",
    "functions_wait",
    "functions_spawn_agent",
    "functions_close_agent",
    "multi_tool_use_parallel",
  ])
  .meta({ id: "ToolName" });

export type ToolName = z.infer<typeof ToolNameSchema>;

export const AssistantTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .meta({ id: "AssistantTextBlock" });

export const AssistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.array(AssistantTextBlockSchema),
  })
  .meta({ id: "AssistantMessage" });

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

export const AgentStreamEventSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("assistant"),
      message: AssistantMessageSchema,
    }),
    z.object({
      type: z.literal("tool_call"),
      tool_name: z.string(),
      input: z.unknown(),
    }),
    z.object({
      type: z.literal("tool_result"),
      tool_name: z.string(),
      output: z.unknown(),
    }),
    z.object({
      type: z.literal("status"),
      status: AgentStatusSchema,
    }),
    z.object({
      type: z.literal("error"),
      error: z.string(),
    }),
  ])
  .meta({ id: "AgentStreamEvent" });

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

export const ExecCommandArgsSchema = z
  .object({
    cmd: z.string(),
    justification: z.string().optional(),
    login: z.boolean().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    prefix_rule: z.array(z.string()).optional(),
    shell: z.string().optional(),
    tty: z.boolean().optional(),
    workdir: z.string().optional(),
    yield_time_ms: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "FunctionsExecCommandArgs" });

export const ExecCommandResultSchema = z
  .object({
    session_id: z.number().optional(),
    stdout: z.string(),
    stderr: z.string(),
    exit_code: z.number().nullable(),
    running: z.boolean(),
    truncated: z.boolean().optional(),
  })
  .meta({ id: "FunctionsExecCommandResult" });

export const WriteStdinArgsSchema = z
  .object({
    session_id: z.number().int().positive(),
    chars: z.string().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    yield_time_ms: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "FunctionsWriteStdinArgs" });

export const WriteStdinResultSchema = ExecCommandResultSchema.meta({
  id: "FunctionsWriteStdinResult",
});

export const PlanItemSchema = z
  .object({
    step: z.string(),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .meta({ id: "PlanItem" });

export const UpdatePlanArgsSchema = z
  .object({
    explanation: z.string().optional(),
    plan: z.array(PlanItemSchema),
  })
  .meta({ id: "FunctionsUpdatePlanArgs" });

export const ViewImageOrDocumentArgsSchema = z
  .object({
    path: z.string(),
    ocr: z.boolean().optional(),
  })
  .meta({ id: "FunctionsViewImageOrDocumentArgs" });

export const WaitArgsSchema = z
  .object({
    ids: z.array(z.string()),
    timeout_ms: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "FunctionsWaitArgs" });

export const SpawnExtraAgentArgsSchema = z
  .object({
    fork_context: z.boolean().optional(),
    instruction: z.string(),
    maxSteps: z.number().int().positive().optional(),
  })
  .meta({ id: "FunctionsSpawnAgentArgs" });

export const CloseAgentArgsSchema = z
  .object({
    id: z.string(),
  })
  .meta({ id: "FunctionsCloseAgentArgs" });

export const ParallelToolUseSchema = z
  .object({
    recipient_name: z.string(),
    parameters: z.unknown(),
  })
  .meta({ id: "ParallelToolUse" });

export const ParallelArgsSchema = z
  .object({
    tool_uses: z.array(ParallelToolUseSchema),
  })
  .meta({ id: "MultiToolUseParallelArgs" });

export type ExecCommandArgs = z.infer<typeof ExecCommandArgsSchema>;
export type ExecCommandResult = z.infer<typeof ExecCommandResultSchema>;
export type WriteStdinArgs = z.infer<typeof WriteStdinArgsSchema>;
export type WriteStdinResult = z.infer<typeof WriteStdinResultSchema>;
export const FunctionExecCommandArgsSchema = ExecCommandArgsSchema;
export const FunctionWriteStdinArgsSchema = WriteStdinArgsSchema;
export type FunctionExecCommandArgs = ExecCommandArgs;
export type FunctionWriteStdinArgs = WriteStdinArgs;
export type UpdatePlanArgs = z.infer<typeof UpdatePlanArgsSchema>;
export type ViewImageOrDocumentArgs = z.infer<
  typeof ViewImageOrDocumentArgsSchema
>;
export type WaitArgs = z.infer<typeof WaitArgsSchema>;
export type SpawnExtraAgentArgs = z.infer<typeof SpawnExtraAgentArgsSchema>;
export type CloseAgentArgs = z.infer<typeof CloseAgentArgsSchema>;
export type ParallelArgs = z.infer<typeof ParallelArgsSchema>;

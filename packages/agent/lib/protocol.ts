import { z } from "zod/v4";
import { Api } from "@browserbasehq/stagehand";

export const DEFAULT_INITIAL_SUBAGENT_COUNT = 3;
export const DEFAULT_SUBAGENT_COUNT = DEFAULT_INITIAL_SUBAGENT_COUNT;

export const BrowserIdSchema = z.enum(["1", "2", "3"]).meta({
  id: "AgentBrowserId",
  description:
    "Stable browser slot identifier for the initial Stagehand-backed subagents.",
});

export type BrowserId = z.infer<typeof BrowserIdSchema>;

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

export const AgentSubagentConfigSchema = z
  .object({
    mode: z.enum(["dom", "hybrid", "cua"]).optional(),
    model: ModelInputSchema.optional(),
    executionModel: ModelInputSchema.optional(),
    systemPrompt: z.string().optional(),
    verbose: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    experimental: z.boolean().optional(),
    localBrowserLaunchOptions: Api.LocalBrowserLaunchOptionsSchema.optional(),
  })
  .meta({
    id: "AgentSubagentConfig",
    description:
      "Serializable configuration for one delegated Stagehand subagent.",
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

export const ToolNamespaceSchema = z
  .enum(["web", "functions", "multi_tool_use"])
  .meta({ id: "ToolNamespace" });

export type ToolNamespace = z.infer<typeof ToolNamespaceSchema>;

export const ToolNameSchema = z
  .enum([
    "web_spawn_agent",
    "web_act",
    "web_extract",
    "web_observe",
    "web_navigate",
    "web_screenshot",
    "web_search",
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

export const SubagentTaskStatusSchema = z
  .enum(["queued", "running", "completed", "failed"])
  .meta({ id: "SubagentTaskStatus" });

export type SubagentTaskStatus = z.infer<typeof SubagentTaskStatusSchema>;

export const SubagentTaskRecordSchema = z
  .object({
    id: z.string(),
    browser_id: BrowserIdSchema,
    instruction: z.string(),
    status: SubagentTaskStatusSchema,
    expected_output_jsonschema: JsonObjectSchema.optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .meta({
    id: "SubagentTaskRecord",
    description:
      "Append-only task record persisted to TODO.md so the orchestration layer remains reconstructable from disk.",
  });

export type SubagentTaskRecord = z.infer<typeof SubagentTaskRecordSchema>;

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

export const WebSpawnAgentArgsSchema = z
  .object({
    instruction: z.string(),
    browser_id: BrowserIdSchema,
    expected_output_jsonschema: JsonObjectSchema.optional(),
    maxSteps: z.number().int().positive().optional(),
  })
  .meta({ id: "WebSpawnAgentArgs" });

export const WebActArgsSchema = z
  .object({
    microtask: z.string(),
    browser_id: BrowserIdSchema,
    frame_id: z.string().optional(),
  })
  .meta({ id: "WebActArgs" });

export const WebExtractArgsSchema = z
  .object({
    browser_id: BrowserIdSchema,
    frame_id: z.string().optional(),
    instruction: z.string().optional(),
    expected_output_jsonschema: JsonObjectSchema.optional(),
  })
  .meta({ id: "WebExtractArgs" });

export const WebObserveArgsSchema = z
  .object({
    browser_id: BrowserIdSchema,
    instruction: z.string().optional(),
    frame_id: z.string().optional(),
  })
  .meta({ id: "WebObserveArgs" });

export const WaitUntilSchema = z.enum([
  "load",
  "domcontentloaded",
  "networkidle",
]);

export type WaitUntil = z.infer<typeof WaitUntilSchema>;

export const WebNavigateArgsSchema = z
  .object({
    browser_id: BrowserIdSchema,
    url: z.string().url(),
    waitUntil: WaitUntilSchema.optional(),
  })
  .meta({ id: "WebNavigateArgs" });

export const WebScreenshotArgsSchema = z
  .object({
    browser_id: BrowserIdSchema,
    frame_id: z.string().optional(),
    selector: z.string().optional(),
    y_offset: z.number().optional(),
  })
  .meta({ id: "WebScreenshotArgs" });

export const WebSearchArgsSchema = z
  .object({
    query: z.string(),
    max_results: z.number().int().positive().max(20).optional(),
  })
  .meta({ id: "WebSearchArgs" });

export const WebSearchResultItemSchema = z
  .object({
    title: z.string(),
    url: z.string(),
    snippet: z.string().optional(),
  })
  .meta({ id: "WebSearchResultItem" });

export const WebSearchResultSchema = z
  .object({
    query: z.string(),
    results: z.array(WebSearchResultItemSchema),
  })
  .meta({ id: "WebSearchResult" });

export const NavigateResultSchema = z
  .object({
    url: z.string(),
    status: z.number().nullable(),
    ok: z.boolean().nullable(),
    status_text: z.string().nullable(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .meta({ id: "AgentNavigateResult" });

export const ScreenshotResultSchema = z
  .object({
    browser_id: BrowserIdSchema,
    frame_id: z.string().optional(),
    path: z.string(),
    url: z.string().optional(),
    selector: z.string().optional(),
    y_offset: z.number().optional(),
  })
  .meta({ id: "AgentScreenshotResult" });

export type WebSpawnAgentArgs = z.infer<typeof WebSpawnAgentArgsSchema>;
export type WebActArgs = z.infer<typeof WebActArgsSchema>;
export type WebExtractArgs = z.infer<typeof WebExtractArgsSchema>;
export type WebObserveArgs = z.infer<typeof WebObserveArgsSchema>;
export type WebNavigateArgs = z.infer<typeof WebNavigateArgsSchema>;
export type WebScreenshotArgs = z.infer<typeof WebScreenshotArgsSchema>;
export type WebSearchArgs = z.infer<typeof WebSearchArgsSchema>;
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;
export type NavigateResult = z.infer<typeof NavigateResultSchema>;
export type ScreenshotResult = z.infer<typeof ScreenshotResultSchema>;

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

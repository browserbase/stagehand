import path from "node:path";
import process from "node:process";
import {
  getAISDKLanguageModel,
  type ClientOptions,
  type ModelMessage,
} from "@browserbasehq/stagehand";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod/v4";

import { ProcessSessionManager } from "./processSessions.js";
import {
  type AgentOptions,
  AgentOptionsSchema,
  type AgentStatus,
  type AgentStreamEvent,
  type BrowserId,
  type ExecCommandArgs,
  ExecCommandArgsSchema,
  type ParallelArgs,
  ParallelArgsSchema,
  type ToolName,
  type UpdatePlanArgs,
  UpdatePlanArgsSchema,
  type ViewImageOrDocumentArgs,
  ViewImageOrDocumentArgsSchema,
  type WaitArgs,
  WaitArgsSchema,
  type WebActArgs,
  WebActArgsSchema,
  type WebExtractArgs,
  WebExtractArgsSchema,
  type WebNavigateArgs,
  WebNavigateArgsSchema,
  type WebObserveArgs,
  WebObserveArgsSchema,
  type WebScreenshotArgs,
  WebScreenshotArgsSchema,
  type WebSearchArgs,
  WebSearchArgsSchema,
  type WebSpawnAgentArgs,
  WebSpawnAgentArgsSchema,
  type WriteStdinArgs,
  WriteStdinArgsSchema,
} from "./protocol.js";
import { duckDuckGoSearch } from "./search.js";
import { SubagentRuntime } from "./SubagentRuntime.js";
import { createDeferredToolStubs } from "./subagentToolStubs.js";
import { AsyncQueue } from "./utils/asyncQueue.js";
import {
  appendTopLevelTask,
  ensureWorkspaceLayout,
  normalizeSubagentConfigs,
  type SubagentWorkspaceLayout,
  type WorkspaceLayout,
} from "./workspace.js";

const DEFAULT_MAX_STEPS = 20;

export interface RuntimeAgentOptions extends AgentOptions {
  clientOptions?: ClientOptions;
}

type AgentDependencies = {
  subagentFactory?: (options: {
    browserId: BrowserId;
    workspace: SubagentWorkspaceLayout;
    config: RuntimeAgentOptions["subagents"] extends Array<infer T> ? T : never;
  }) => SubagentRuntime;
};

export class Agent {
  public readonly options: RuntimeAgentOptions;
  public readonly workspace: string;
  public readonly subagents: SubagentRuntime[];
  public status: AgentStatus = "idle";

  private readonly processSessions = new ProcessSessionManager();
  private readonly ready: Promise<void>;
  private readonly dependencies: AgentDependencies;
  private readonly deferredToolStubs: ReturnType<typeof createDeferredToolStubs>;
  private readonly systemPrompt: string;
  private messages: ModelMessage[] = [];
  private currentStream: AsyncQueue<AgentStreamEvent> | null = null;
  private planState: UpdatePlanArgs | null = null;
  private layout: WorkspaceLayout | null = null;

  constructor(
    options: RuntimeAgentOptions,
    dependencies: AgentDependencies = {},
  ) {
    this.options = AgentOptionsSchema.parse(options) as RuntimeAgentOptions;
    this.dependencies = dependencies;
    this.workspace = path.resolve(this.options.workspace ?? process.cwd());
    this.subagents = normalizeSubagentConfigs(this.options.subagents).map(
      ({ browserId, ...config }) =>
        (this.dependencies.subagentFactory?.({
          browserId,
          workspace: buildWorkspaceLayout(this.workspace, browserId),
          config,
        }) ??
          new SubagentRuntime({
            browserId,
            workspace: buildWorkspaceLayout(this.workspace, browserId),
            config,
          })) as SubagentRuntime,
    );
    this.deferredToolStubs = createDeferredToolStubs({
      onUpdatePlan: async (input) => {
        this.planState = input;
        return {
          ok: true,
          explanation: input.explanation ?? null,
          plan: input.plan,
        };
      },
    });
    this.systemPrompt = buildSystemPrompt(this.workspace, this.options.systemPrompt);
    this.ready = this.initialize();
  }

  public async send(instruction: string): Promise<void> {
    if (this.status === "running") {
      throw new Error(
        "Agent is already running. Wait for the current stream to finish.",
      );
    }

    await this.ready;
    await appendTopLevelTask(this.requireLayout().todoPath, instruction);

    const queue = new AsyncQueue<AgentStreamEvent>();
    this.currentStream = queue;
    this.status = "running";
    queue.push({ type: "status", status: "running" });

    const userMessage: ModelMessage = { role: "user", content: instruction };
    const turnMessages = [...this.messages, userMessage];

    const [provider, ...modelParts] = this.options.modelName.split("/");
    const modelName = modelParts.join("/");
    if (!provider || !modelName) {
      throw new Error(
        `modelName must use provider/model format, received ${this.options.modelName}`,
      );
    }

    let finishTurn!: (messages: ModelMessage[]) => void;
    let failTurn!: (error: unknown) => void;
    const finished = new Promise<ModelMessage[]>((resolve, reject) => {
      finishTurn = resolve;
      failTurn = reject;
    });

    const result = streamText({
      model: getAISDKLanguageModel(provider, modelName, this.options.clientOptions),
      system: this.systemPrompt,
      messages: turnMessages,
      tools: this.createAiTools(queue),
      stopWhen: stepCountIs(this.options.maxSteps ?? DEFAULT_MAX_STEPS),
      onFinish: (event) => {
        finishTurn(event.response?.messages ?? []);
      },
      onError: (event) => {
        failTurn(event.error);
      },
    });

    void (async () => {
      let assistantText = "";
      try {
        for await (const delta of result.textStream) {
          assistantText += delta;
          queue.push({
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: delta }],
            },
          });
        }

        const responseMessages = await finished;
        const fallbackAssistantMessage: ModelMessage = {
          role: "assistant",
          content: assistantText,
        };
        this.messages = [
          ...turnMessages,
          ...(responseMessages.length > 0
            ? responseMessages
            : [fallbackAssistantMessage]),
        ];
      } catch (error) {
        queue.push({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.status = "idle";
        queue.push({ type: "status", status: "idle" });
        queue.close();
      }
    })();
  }

  public stream(): AsyncIterable<AgentStreamEvent> {
    if (!this.currentStream) {
      throw new Error("No active stream. Call send() first.");
    }
    return this.currentStream;
  }

  public async close(): Promise<void> {
    await Promise.all(this.subagents.map((subagent) => subagent.close()));
    await this.processSessions.closeAll();
    this.status = "idle";
  }

  private async initialize(): Promise<void> {
    this.layout = await ensureWorkspaceLayout(this.workspace);
    await Promise.all(this.subagents.map((subagent) => subagent.init()));
  }

  private requireLayout(): WorkspaceLayout {
    if (!this.layout) {
      throw new Error("Agent workspace is not initialized yet.");
    }
    return this.layout;
  }

  private getSubagent(browserId: BrowserId): SubagentRuntime {
    const subagent = this.subagents.find(
      (candidate) => candidate.browserId === browserId,
    );
    if (!subagent) {
      throw new Error(`Unknown browser_id: ${browserId}`);
    }
    return subagent;
  }

  private createAiTools(queue: AsyncQueue<AgentStreamEvent>) {
    const recordTool = async (
      toolName: ToolName,
      input: unknown,
      run: () => Promise<unknown>,
    ) => {
      queue.push({
        type: "tool_call",
        tool_name: toolName,
        input,
      });
      const output = await run();
      queue.push({
        type: "tool_result",
        tool_name: toolName,
        output,
      });
      return output;
    };

    const runDeferred = async <
      TTool extends keyof typeof this.deferredToolStubs,
      TInput,
    >(
      toolName: TTool,
      input: TInput,
    ) =>
      await (
        this.deferredToolStubs as Record<
          string,
          (value: unknown) => Promise<unknown>
        >
      )[toolName](input);

    return {
      web_spawn_agent: tool({
        description:
          "Queue a delegated Stagehand agent task on browser_id 1, 2, or 3 and wait for the result.",
        inputSchema: WebSpawnAgentArgsSchema,
        execute: async (input: WebSpawnAgentArgs) =>
          await recordTool("web_spawn_agent", input, async () =>
            await this.getSubagent(input.browser_id).enqueueDelegatedTask({
              instruction: input.instruction,
              expectedOutputJsonSchema: input.expected_output_jsonschema,
              maxSteps: input.maxSteps,
            }),
          ),
      }),
      web_act: tool({
        description:
          "Run a short semantic browser microtask in the selected managed browser.",
        inputSchema: WebActArgsSchema,
        execute: async (input: WebActArgs) =>
          await recordTool("web_act", input, async () =>
            await this.getSubagent(input.browser_id).act(input),
          ),
      }),
      web_extract: tool({
        description: "Extract structured data from the selected managed browser.",
        inputSchema: WebExtractArgsSchema,
        execute: async (input: WebExtractArgs) =>
          await recordTool("web_extract", input, async () =>
            await this.getSubagent(input.browser_id).extract({
              instruction: input.instruction,
              frameId: input.frame_id,
              expectedOutputJsonSchema: input.expected_output_jsonschema,
            }),
          ),
      }),
      web_observe: tool({
        description:
          "Ask the selected browser to list likely next actions on the current page.",
        inputSchema: WebObserveArgsSchema,
        execute: async (input: WebObserveArgs) =>
          await recordTool("web_observe", input, async () =>
            await this.getSubagent(input.browser_id).observe({
              instruction: input.instruction,
              frameId: input.frame_id,
            }),
          ),
      }),
      web_navigate: tool({
        description: "Navigate the selected browser to a URL.",
        inputSchema: WebNavigateArgsSchema,
        execute: async (input: WebNavigateArgs) =>
          await recordTool("web_navigate", input, async () =>
            await this.getSubagent(input.browser_id).navigate({
              url: input.url,
              waitUntil: input.waitUntil,
            }),
          ),
      }),
      web_screenshot: tool({
        description:
          "Save a screenshot into the selected subagent screenshots directory and return serializable metadata.",
        inputSchema: WebScreenshotArgsSchema,
        execute: async (input: WebScreenshotArgs) =>
          await recordTool("web_screenshot", input, async () =>
            await this.getSubagent(input.browser_id).screenshot({
              frameId: input.frame_id,
              selector: input.selector,
              yOffset: input.y_offset,
            }),
          ),
      }),
      web_search: tool({
        description:
          "Run a DuckDuckGo search without opening a browser session.",
        inputSchema: WebSearchArgsSchema,
        execute: async (input: WebSearchArgs) =>
          await recordTool("web_search", input, async () => ({
            query: input.query,
            results: await duckDuckGoSearch(input.query, input.max_results ?? 5),
          })),
      }),
      functions_exec_command: tool({
        description:
          "Run a shell command inside the shared workspace. Long-running commands return a session_id for functions_write_stdin.",
        inputSchema: ExecCommandArgsSchema,
        execute: async (input: ExecCommandArgs) =>
          await recordTool("functions_exec_command", input, async () =>
            await this.processSessions.exec({
              ...input,
              workdir: input.workdir ?? this.workspace,
            }),
          ),
      }),
      functions_write_stdin: tool({
        description: "Write input to a previously started shell session.",
        inputSchema: WriteStdinArgsSchema,
        execute: async (input: WriteStdinArgs) =>
          await recordTool("functions_write_stdin", input, async () =>
            await this.processSessions.write(input),
          ),
      }),
      functions_update_plan: tool({
        description: "Store a lightweight execution plan in the local runtime.",
        inputSchema: UpdatePlanArgsSchema,
        execute: async (input: UpdatePlanArgs) =>
          await recordTool("functions_update_plan", input, async () =>
            ((this.planState = input),
            await runDeferred("functions_update_plan", input)),
          ),
      }),
      functions_view_image_or_document: tool({
        description: "Deferred stub for future artifact/document inspection.",
        inputSchema: ViewImageOrDocumentArgsSchema,
        execute: async (input: ViewImageOrDocumentArgs) =>
          await recordTool(
            "functions_view_image_or_document",
            input,
            async () =>
              await runDeferred("functions_view_image_or_document", input),
          ),
      }),
      functions_wait: tool({
        description: "Deferred stub for waiting on long-lived runtime task ids.",
        inputSchema: WaitArgsSchema,
        execute: async (input: WaitArgs) =>
          await recordTool("functions_wait", input, async () =>
            await runDeferred("functions_wait", input),
          ),
      }),
      functions_spawn_agent: tool({
        description:
          "Deferred stub for dynamically creating extra subagents beyond the initial 1..3 pool.",
        inputSchema: z
          .object({
            fork_context: z.boolean().optional(),
            instruction: z.string(),
            maxSteps: z.number().int().positive().optional(),
          })
          .strict(),
        execute: async (input) =>
          await recordTool("functions_spawn_agent", input, async () =>
            await runDeferred("functions_spawn_agent", input),
          ),
      }),
      functions_close_agent: tool({
        description:
          "Deferred stub for closing dynamically spawned extra agents.",
        inputSchema: z.object({ id: z.string() }).strict(),
        execute: async (input) =>
          await recordTool("functions_close_agent", input, async () =>
            await runDeferred("functions_close_agent", input),
          ),
      }),
      multi_tool_use_parallel: tool({
        description:
          "Deferred stub for host-coordinated parallel tool execution.",
        inputSchema: ParallelArgsSchema,
        execute: async (input: ParallelArgs) =>
          await recordTool("multi_tool_use_parallel", input, async () =>
            await runDeferred("multi_tool_use_parallel", input),
          ),
      }),
    };
  }
}

function buildWorkspaceLayout(
  workspace: string,
  browserId: BrowserId,
): SubagentWorkspaceLayout {
  const rootDir = path.join(workspace, `subagent${browserId}`);
  return {
    browserId,
    rootDir,
    todoPath: path.join(rootDir, "TODO.md"),
    chromeProfileDir: path.join(rootDir, "chrome_profile"),
    downloadsDir: path.join(rootDir, "downloads"),
    logsDir: path.join(rootDir, "logs"),
    screenshotsDir: path.join(rootDir, "screenshots"),
  };
}

function buildSystemPrompt(workspace: string, userPrompt?: string): string {
  return [
    "You are a top-level coding agent coordinating Stagehand-backed browser subagents.",
    "You do not control browsers directly. All browser access must go through the delegated web_* tools.",
    "Use browser_id values 1, 2, or 3 when delegating browser work.",
    `Shared workspace root: ${workspace}`,
    "Each subagent may read the entire workspace, but its browser artifacts live in its own subagent folder.",
    "Prefer functions_exec_command for shell work, local computation, and file operations.",
    userPrompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

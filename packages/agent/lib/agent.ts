import path from "node:path";
import process from "node:process";
import { stepCountIs, streamText, tool } from "ai";
import type { ModelMessage } from "@browserbasehq/stagehand";

import {
  AgentOptionsSchema,
  BrowserIds,
  type AgentOptions,
  type AgentStatus,
  type AgentStreamEvent,
  type BrowserId,
  type ToolName,
} from "./protocol.js";
import {
  buildBrowseCliShellPrefix,
  buildBrowseBrowserSessionArgs,
  runBrowseCli,
} from "./browseCli.js";
import { closeAllManagedAgents } from "./state/agents.js";
import {
  appendLlmMessageLog,
  hydrateTopLevelLanguageModel,
  writeLlmConfig,
} from "./state/llm.js";
import { closeProcessSessions } from "./state/process.js";
import {
  appendConversationEntry,
  appendTopLevelTask,
  createSubagentWorkspaceLayout,
  ensureWorkspaceLayout,
  initializeSessionState,
  normalizeSubagentConfigs,
  writeSubagentConfig,
  type WorkspaceLayout,
} from "./state/session.js";
import { ALL_TOOLS, type AgentToolContext } from "./tools/index.js";
import { AsyncQueue } from "./utils/asyncQueue.js";

const DEFAULT_MAX_STEPS = 20;

export interface RuntimeAgentOptions extends AgentOptions {}

export type AgentSubagentHandle = {
  browserId: BrowserId;
  subagentDir: string;
  logsDir: string;
  todoPath: string;
  configPath: string;
};

function buildSubagentHandle(
  workspace: string,
  browserId: BrowserId,
): AgentSubagentHandle {
  const layout = createSubagentWorkspaceLayout(workspace, browserId);
  return {
    browserId,
    subagentDir: layout.rootDir,
    logsDir: layout.logsDir,
    todoPath: layout.todoPath,
    configPath: layout.configPath,
  };
}

export class Agent {
  public readonly options: RuntimeAgentOptions;
  public readonly workspace: string;
  public readonly subagents: AgentSubagentHandle[];
  public status: AgentStatus = "idle";

  private readonly ready: Promise<void>;
  private readonly systemPrompt: string;
  private messages: ModelMessage[] = [];
  private currentStream: AsyncQueue<AgentStreamEvent> | null = null;
  private layout: WorkspaceLayout | null = null;

  constructor(options: RuntimeAgentOptions) {
    this.options = AgentOptionsSchema.parse(options) as RuntimeAgentOptions;
    this.workspace = path.resolve(this.options.workspace ?? process.cwd());
    this.subagents = BrowserIds.map((browserId) =>
      buildSubagentHandle(this.workspace, browserId),
    );
    this.systemPrompt = buildSystemPrompt(
      this.workspace,
      this.options.modelName,
      this.options.systemPrompt,
    );
    this.ready = this.initialize();
  }

  public async send(instruction: string): Promise<void> {
    if (this.status === "running") {
      throw new Error(
        "Agent is already running. Wait for the current stream to finish.",
      );
    }

    await this.ready;
    const layout = this.requireLayout();
    await appendTopLevelTask(layout.todoPath, instruction);
    await appendConversationEntry(this.workspace, {
      role: "user",
      content: instruction,
    });
    await appendLlmMessageLog(this.workspace, {
      direction: "request",
      scope: "top-level-agent",
      payload: { instruction },
    });

    const queue = new AsyncQueue<AgentStreamEvent>();
    this.currentStream = queue;
    this.status = "running";
    queue.push({ type: "status", status: "running" });

    const userMessage: ModelMessage = { role: "user", content: instruction };
    const turnMessages = [...this.messages, userMessage];
    const llm = await hydrateTopLevelLanguageModel(this.workspace, this.options);

    const result = streamText({
      model: llm.model,
      system: this.systemPrompt,
      messages: turnMessages,
      tools: this.createAiTools(queue),
      stopWhen: stepCountIs(this.options.maxSteps ?? DEFAULT_MAX_STEPS),
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

        const assistantMessage: ModelMessage = {
          role: "assistant",
          content: assistantText,
        };
        this.messages = [...turnMessages, assistantMessage];
        await appendConversationEntry(this.workspace, {
          role: "assistant",
          content: assistantText,
        });
        await appendLlmMessageLog(this.workspace, {
          direction: "response",
          scope: "top-level-agent",
          payload: { text: assistantText },
        });
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
    await Promise.all([
      closeAllManagedAgents(this.workspace),
      closeProcessSessions(this.workspace),
      ...BrowserIds.map(async (browserId): Promise<void> => {
        await runBrowseCli(
          [
            ...buildBrowseBrowserSessionArgs(browserId),
            "stop",
            "--force",
          ],
        ).catch((): undefined => undefined);
      }),
    ]);
    this.status = "idle";
  }

  private async initialize(): Promise<void> {
    this.layout = await initializeSessionState({
      workspace: this.workspace,
      systemPrompt: this.options.systemPrompt,
      maxSteps: this.options.maxSteps,
      subagents: this.options.subagents,
    });
    await ensureWorkspaceLayout(this.workspace);
    await writeLlmConfig(this.workspace, {
      modelName: this.options.modelName,
      clientOptions: this.options.clientOptions,
    });

    for (const { browserId, ...config } of normalizeSubagentConfigs(
      this.options.subagents,
    )) {
      await writeSubagentConfig(this.layout.subagents[browserId], config);
    }
  }

  private requireLayout(): WorkspaceLayout {
    if (!this.layout) {
      throw new Error("Agent workspace is not initialized yet.");
    }
    return this.layout;
  }

  private async dispatchToolCall(
    toolName: ToolName,
    input: unknown,
  ): Promise<unknown> {
    const toolSpec = ALL_TOOLS[toolName];
    if (!toolSpec) {
      throw new Error(`Unsupported tool: ${toolName}`);
    }

    const parsedInput = toolSpec.inputSchema.parse(input);
    const output = await toolSpec.execute(parsedInput, this.buildToolContext());
    return toolSpec.outputSchema.parse(output);
  }

  private buildToolContext(): AgentToolContext {
    return {
      workspace: this.workspace,
    };
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

    const aiTools = {} as Record<ToolName, ReturnType<typeof tool<any, any>>>;
    for (const [toolName, toolSpec] of Object.entries(ALL_TOOLS) as Array<
      [ToolName, (typeof ALL_TOOLS)[ToolName]]
    >) {
      aiTools[toolName] = tool({
        description: toolSpec.description,
        inputSchema: toolSpec.inputSchema as never,
        execute: async (input: unknown) =>
          await recordTool(toolName, input, async () =>
            await this.dispatchToolCall(toolName, input),
          ),
      });
    }

    return aiTools;
  }
}

function buildSystemPrompt(
  workspace: string,
  modelName: string,
  userPrompt?: string,
): string {
  const browsePrefix = buildBrowseCliShellPrefix();
  return [
    "You are a top-level coding agent coordinating browser work through the browse CLI.",
    "You do not have browser-specific tool wrappers.",
    "Use functions_exec_command to run the browse CLI directly.",
    `Use commands like: ${browsePrefix} --session browser-1 open https://example.com.`,
    `Other direct browser commands use the same prefix: ${browsePrefix} --session <name> act|observe|extract|screenshot ...`,
    `browse act, browse observe, and browse extract inherit model defaults from env in this workspace. Do not add --model unless you intentionally want to override ${modelName}.`,
    `Shared workspace root: ${workspace}`,
    "Prefer functions_exec_command for shell work, local computation, and file operations.",
    "Use functions_spawn_agent to launch extra background browser agents and functions_wait to join them later.",
    "Spawned subagents already run inside browse subagent with their own browser tool surface.",
    "When using functions_spawn_agent, give the child a goal and output requirements only. Do not tell it to use functions_exec_command, shell out to browse, or discover CLI paths.",
    userPrompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

import {
  AgentAction,
  AgentExecuteOptions,
  AgentResult,
  ActToolResult,
} from "@/types/agent";
import { LogLine } from "@/types/log";
import { LLMClient } from "../llm/LLMClient";
import { CoreMessage, wrapLanguageModel } from "ai";
import { LanguageModel } from "ai";
import { StreamTextResult } from "ai";
import { processMessages } from "../agent/utils/messageProcessing";
import { createAgentTools } from "../agent/tools";
import type { AgentTools } from "../agent/tools";
import { ToolSet } from "ai";
import { Stagehand } from "../index";

export class StagehandAgentHandler {
  private stagehand: Stagehand;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private tools?: ToolSet;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private screenshotCollector?: any;

  constructor(
    stagehand: Stagehand,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    tools?: ToolSet,
  ) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.llmClient = llmClient;
    this.executionModel = executionModel;
    this.systemInstructions = systemInstructions;
    this.tools = tools;
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    const maxSteps = options.maxSteps || 10;
    const actions: AgentAction[] = [];
    let finalMessage = "";
    let completed = false;
    const collectedReasoning: string[] = [];

    this.logger({
      category: "agent",
      message: `Executing agent task: ${options.instruction}`,
      level: 1,
      auxiliary: {
        maxSteps: {
          value: String(maxSteps),
          type: "integer",
        },
        hasSystemInstructions: {
          value: String(!!this.systemInstructions),
          type: "boolean",
        },
        hasCustomTools: {
          value: String(!!this.tools),
          type: "boolean",
        },
      },
    });

    try {
      const systemPrompt = this.buildSystemPrompt(
        options.instruction,
        this.systemInstructions,
      );
      const defaultTools = this.createTools();
      const allTools = { ...defaultTools, ...this.tools };

      this.logger({
        category: "agent",
        message: "Initialized agent configuration",
        level: 2,
        auxiliary: {
          systemPromptLength: {
            value: String(systemPrompt.length),
            type: "integer",
          },
          toolCount: {
            value: String(Object.keys(allTools).length),
            type: "integer",
          },
          tools: {
            value: Object.keys(allTools).join(", "),
            type: "string",
          },
        },
      });

      const messages: CoreMessage[] = [
        {
          role: "user",
          content: options.instruction,
        },
      ];

      if (!this.llmClient) {
        throw new Error(
          "LLM client is not initialized. Please ensure you have the required API keys set (e.g., OPENAI_API_KEY) and that the model configuration is correct.",
        );
      }

      if (!this.llmClient.getLanguageModel) {
        throw new Error(
          "StagehandAgentHandler requires an AISDK-backed LLM client. Ensure your model is configured like 'openai/gpt-4.1-mini' in the provider/model format.",
        );
      }
      const baseModel: LanguageModel = this.llmClient.getLanguageModel();
      const wrappedModel = wrapLanguageModel({
        model: baseModel,
        middleware: {
          transformParams: async ({ params }) => {
            const { processedPrompt } = processMessages(params);
            return { ...params, prompt: processedPrompt };
          },
        },
      });

      const result = await this.llmClient.generateText({
        model: wrappedModel,
        system: systemPrompt,
        messages,
        tools: allTools,
        maxSteps,
        temperature: 1,
        toolChoice: "auto",
        onStepFinish: async (event) => {
          if (options.onStepFinish) {
            await options.onStepFinish(event);
          }

          if (event.toolCalls && event.toolCalls.length > 0) {
            for (let i = 0; i < event.toolCalls.length; i++) {
              const toolCall = event.toolCalls[i];
              const args = toolCall.args as Record<string, unknown>;

              if (event.text.length > 0) {
                collectedReasoning.push(event.text);
                this.logger({
                  category: "agent",
                  message: `Agent Reasoning: ${event.text}`,
                  level: 1,
                });
              }

              if (toolCall.toolName === "close") {
                completed = true;
                const { success, reasoning } = args;
                if (success) {
                  const closeReasoning = reasoning as string;
                  const allReasoning = collectedReasoning.join(" ");
                  finalMessage = closeReasoning
                    ? `${allReasoning} ${closeReasoning}`.trim()
                    : allReasoning || `Task completed with success: ${success}`;
                }
              }

              // Get the tool result if available to enrich action (act tool)
              const toolResult = event.toolResults?.[i];

              const getPlaywrightArguments = () => {
                if (toolCall.toolName !== "act" || !toolResult) {
                  return {};
                }
                const result = toolResult.result as ActToolResult;
                if (result && result.playwrightArguments) {
                  return { playwrightArguments: result.playwrightArguments };
                }

                return {};
              };

              const action: AgentAction = {
                type: toolCall.toolName,
                reasoning: event.text || undefined,
                taskCompleted:
                  toolCall.toolName === "close"
                    ? (args?.success as boolean)
                    : false,
                ...args,
                ...getPlaywrightArguments(),
              };

              actions.push(action);
            }
          }
        },
      });

      if (!finalMessage) {
        const allReasoning = collectedReasoning.join(" ").trim();
        finalMessage = allReasoning || result.text;
      }

      const endTime = Date.now();
      const inferenceTimeMs = endTime - startTime;

      this.logger({
        category: "agent",
        message: `Agent task ${completed ? "completed" : "finished"}`,
        level: 1,
      });

      return {
        success: completed,
        message: finalMessage || "Task execution completed",
        actions,
        completed,
        usage: result.usage
          ? {
              input_tokens: result.usage.promptTokens || 0,
              output_tokens: result.usage.completionTokens || 0,
              inference_time_ms: inferenceTimeMs,
            }
          : undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger({
        category: "agent",
        message: `Error executing agent task: ${errorMessage}`,
        level: 0,
      });

      return {
        success: false,
        actions,
        message: `Failed to execute task: ${errorMessage}`,
        completed: false,
      };
    }
  }

  /**
   * Stream method that exposes the AI SDK's streamText functionality with real-time callbacks.
   *
   * Note on type parameters:
   * - AgentTools & ToolSet: The combined type of our agent tools and any MCP tools
   * - never: The PARTIAL_OUTPUT type is set to 'never' because we're not using experimental_output.
   */
  public async stream(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<StreamTextResult<AgentTools & ToolSet, never>> {
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    const maxSteps = options.maxSteps || 10;
    const actions: AgentAction[] = [];
    const collectedReasoning: string[] = [];

    try {
      const { systemPrompt, messages, allTools, wrappedModel } =
        this.prepareLLM(options.instruction);

      const result = this.llmClient.streamText({
        model: wrappedModel,
        system: systemPrompt,
        messages,
        tools: allTools,
        maxSteps,
        temperature: 1,
        toolChoice: "auto",
        abortSignal: (
          options as AgentExecuteOptions & { abortSignal?: AbortSignal }
        ).abortSignal,
        onStepFinish: async (event) => {
          this.logger({
            category: "agent",
            message: `Step finished: ${event.finishReason}`,
            level: 2,
          });

          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const toolCall of event.toolCalls) {
              const args = toolCall.args as Record<string, unknown>;

              if (event.text.length > 0) {
                collectedReasoning.push(event.text);
                this.logger({
                  category: "agent",
                  message: `reasoning: ${event.text}`,
                  level: 1,
                });
              }

              actions.push(this.buildAction(toolCall, args, event.text));
            }
          }

          if ((options as AgentExecuteOptions).onStepFinish) {
            await (options as AgentExecuteOptions).onStepFinish(event);
          }
        },
        onFinish: async (event) => {
          if ((options as AgentExecuteOptions).onFinish) {
            await (options as AgentExecuteOptions).onFinish(event);
          }
        },
        onError: async (event) => {
          this.logger({
            category: "agent",
            message: `Error during streaming: ${event.error}`,
            level: 0,
          });
          if ((options as AgentExecuteOptions).onError) {
            await (options as AgentExecuteOptions).onError(event);
          }
        },
        onChunk: (options as AgentExecuteOptions).onChunk,
      });

      return result as StreamTextResult<AgentTools & ToolSet, never>;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger({
        category: "agent",
        message: `Error setting up stream: ${errorMessage}`,
        level: 0,
      });

      throw error;
    }
  }

  /**
   * Prepare common LLM params (system prompt, messages, tools, wrapped model)
   * used by both execute() and stream().
   */
  private prepareLLM(instruction: string): {
    systemPrompt: string;
    messages: CoreMessage[];
    allTools: AgentTools & ToolSet;
    wrappedModel: LanguageModel;
  } {
    const systemPrompt = this.buildSystemPrompt(
      instruction,
      this.systemInstructions,
    );
    const defaultTools = this.createTools();
    const allTools = { ...defaultTools, ...this.tools };
    const messages: CoreMessage[] = [
      {
        role: "user",
        content: instruction,
      },
    ];

    if (!this.llmClient) {
      throw new Error(
        "LLM client is not initialized. Please ensure you have the required API keys set (e.g., OPENAI_API_KEY) and that the model configuration is correct.",
      );
    }

    if (!this.llmClient.getLanguageModel) {
      throw new Error(
        "StagehandAgentHandler requires an AISDK-backed LLM client. Ensure your model is configured like 'openai/gpt-4.1-mini' in the provider/model format.",
      );
    }
    const baseModel: LanguageModel = this.llmClient.getLanguageModel();
    const wrappedModel = wrapLanguageModel({
      model: baseModel,
      middleware: {
        transformParams: async ({ params }) => {
          const { processedPrompt } = processMessages(params);
          return { ...params, prompt: processedPrompt };
        },
      },
    });

    return { systemPrompt, messages, allTools, wrappedModel };
  }

  /**
   * Build an AgentAction from a tool call, optionally enriching with
   * playwrightArguments when available (execute path only).
   */
  private buildAction(
    toolCall: { toolName: string },
    args: Record<string, unknown>,
    reasoning?: string,
    toolResult?: { result?: unknown },
  ): AgentAction {
    let playwrightArguments: AgentAction["playwrightArguments"];
    if (toolCall.toolName === "act" && toolResult && toolResult.result) {
      const actResult = toolResult.result as ActToolResult;
      if (actResult && actResult.playwrightArguments) {
        playwrightArguments = actResult.playwrightArguments;
      }
    }

    const action: AgentAction = {
      type: toolCall.toolName,
      reasoning: reasoning || undefined,
      taskCompleted:
        toolCall.toolName === "close" ? (args?.taskComplete as boolean) : false,
      ...args,
    };

    if (playwrightArguments) {
      action.playwrightArguments = playwrightArguments;
    }

    return action;
  }

  // in the future if we continue to describe tools in system prompt, we need to make sure to update them in here when new tools are added or removed. still tbd on whether we want to keep them in here long term.
  private buildSystemPrompt(
    executionInstruction: string,
    systemInstructions?: string,
  ): string {
    if (systemInstructions) {
      return `${systemInstructions}
Your current goal: ${executionInstruction}`;
    }

    return `You are a web automation assistant using browser automation tools to accomplish the user's goal.

Your task: ${executionInstruction}

You have access to various browser automation tools. Use them step by step to complete the task.

IMPORTANT GUIDELINES:
1. Always start by understanding the current page state
2. Use the screenshot tool to verify page state when needed
3. Use appropriate tools for each action
4. When the task is complete, use the "close" tool with success: true
5. If the task cannot be completed, use "close" with success: false

TOOLS OVERVIEW:
- screenshot: Take a compressed JPEG screenshot for quick visual context (use sparingly)
- ariaTree: Get an accessibility (ARIA) hybrid tree for full page context (preferred for understanding layout and elements)
- act: Perform a specific atomic action (click, type, etc.). For filling a field, you can say 'fill the field x with the value y'.
- extract: Extract structured data
- goto: Navigate to a URL
- wait/navback/refresh: Control timing and navigation
- scroll: Scroll the page x pixels up or down

STRATEGY:
- Prefer ariaTree to understand the page before acting; use screenshot for quick confirmation.
- Keep actions atomic and verify outcomes before proceeding.

For each action, provide clear reasoning about why you're taking that step.
Today's date is ${new Date().toLocaleDateString()}. You're currently on the website: ${this.stagehand.page.url}.`;
  }

  private createTools() {
    return createAgentTools(this.stagehand, {
      executionModel: this.executionModel,
      logger: this.logger,
    });
  }
  /**
   * Set the screenshot collector for this agent handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setScreenshotCollector(collector: any): void {
    this.screenshotCollector = collector;
  }

  /**
   * Get the screenshot collector
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getScreenshotCollector(): any {
    return this.screenshotCollector;
  }
  setTools(tools: ToolSet): void {
    this.tools = tools;
  }
}

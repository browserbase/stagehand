import { createAgentTools, AgentTools } from "../agent/tools";
import { LogLine } from "../types/public/logs";
import { V3 } from "../v3";
import {
  ModelMessage,
  ToolSet,
  wrapLanguageModel,
  stepCountIs,
  StreamTextResult,
  LanguageModel,
} from "ai";
import { processMessages } from "../agent/utils/messageProcessing";
import { LLMClient } from "../llm/LLMClient";
import {
  AgentAction,
  AgentExecuteOptions,
  AgentResult,
} from "../types/public/agent";
import { V3FunctionName } from "../types/public/methods";
import { mapToolResultToActions } from "../agent/utils/actionMapping";

export class V3AgentHandler {
  private v3: V3;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;

  constructor(
    v3: V3,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    mcpTools?: ToolSet,
  ) {
    this.v3 = v3;
    this.logger = logger;
    this.llmClient = llmClient;
    this.executionModel = executionModel;
    this.systemInstructions = systemInstructions;
    this.mcpTools = mcpTools;
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

    let currentPageUrl = (await this.v3.context.awaitActivePage()).url();

    try {
      const { systemPrompt, messages, allTools, wrappedModel } =
        this.prepareLLM(options.instruction);

      const result = await this.llmClient.generateText({
        model: wrappedModel,
        system: systemPrompt,
        messages,
        tools: allTools,
        stopWhen: stepCountIs(maxSteps),
        temperature: 1,
        toolChoice: "auto",
        onStepFinish: async (event) => {
          this.logger({
            category: "agent",
            message: `Step finished: ${event.finishReason}`,
            level: 2,
          });

          if (event.toolCalls && event.toolCalls.length > 0) {
            for (let i = 0; i < event.toolCalls.length; i++) {
              const toolCall = event.toolCalls[i];
              const args = toolCall.input as Record<string, unknown>;
              const toolResult = event.toolResults?.[i];

              if (event.text.length > 0) {
                collectedReasoning.push(event.text);
                this.logger({
                  category: "agent",
                  message: `reasoning: ${event.text}`,
                  level: 1,
                });
              }

              if (toolCall.toolName === "close") {
                completed = true;
                if (args?.taskComplete) {
                  const closeReasoning = args.reasoning;
                  const allReasoning = collectedReasoning.join(" ");
                  finalMessage = closeReasoning
                    ? `${allReasoning} ${closeReasoning}`.trim()
                    : allReasoning || "Task completed successfully";
                }
              }

              const mappedActions = this.buildActions({
                toolCallName: toolCall.toolName,
                toolResult,
                args,
                reasoning: event.text || undefined,
                currentPageUrl,
              });

              actions.push(...mappedActions);
            }
            currentPageUrl = (await this.v3.context.awaitActivePage()).url();
          }
        },
      });

      if (!finalMessage) {
        const allReasoning = collectedReasoning.join(" ").trim();
        finalMessage = allReasoning || result.text;
      }

      const endTime = Date.now();
      const inferenceTimeMs = endTime - startTime;
      if (result.usage) {
        this.v3.updateMetrics(
          V3FunctionName.AGENT,
          result.usage.inputTokens || 0,
          result.usage.outputTokens || 0,
          inferenceTimeMs,
        );
      }

      return {
        success: completed,
        message: finalMessage || "Task execution completed",
        actions,
        completed,
        usage: result.usage
          ? {
              input_tokens: result.usage.inputTokens || 0,
              output_tokens: result.usage.outputTokens || 0,
              inference_time_ms: inferenceTimeMs,
            }
          : undefined,
      };
    } catch (error) {
      const errorMessage = error?.message ?? String(error);
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

  private buildSystemPrompt(
    executionInstruction: string,
    systemInstructions?: string,
  ): string {
    if (systemInstructions) {
      return `${systemInstructions}\nYour current goal: ${executionInstruction} when the task is complete, use the "close" tool with taskComplete: true`;
    }
    return `You are a web automation assistant using browser automation tools to accomplish the user's goal.\n\nYour task: ${executionInstruction}\n\nYou have access to various browser automation tools. Use them step by step to complete the task.\n\nIMPORTANT GUIDELINES:\n1. Always start by understanding the current page state\n2. Use the screenshot tool to verify page state when needed\n3. Use appropriate tools for each action\n4. When the task is complete, use the "close" tool with taskComplete: true\n5. If the task cannot be completed, use "close" with taskComplete: false\n\nTOOLS OVERVIEW:\n- screenshot: Take a PNG screenshot for quick visual context (use sparingly)\n- ariaTree: Get an accessibility (ARIA) hybrid tree for full page context\n- act: Perform a specific atomic action (click, type, etc.)\n- extract: Extract structured data\n- goto: Navigate to a URL\n- wait/navback/refresh: Control timing and navigation\n- scroll: Scroll the page x pixels up or down\n\nSTRATEGY:\n- Prefer ariaTree to understand the page before acting; use screenshot for confirmation.\n- Keep actions atomic and verify outcomes before proceeding.`;
  }

  private createTools() {
    return createAgentTools(this.v3, {
      executionModel: this.executionModel,
      logger: this.logger,
    });
  }

  public async stream(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<StreamTextResult<ToolSet, never>> {
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    const maxSteps = options.maxSteps || 10;
    const actions: AgentAction[] = [];
    const collectedReasoning: string[] = [];

    let currentPageUrl = (await this.v3.context.awaitActivePage()).url();

    try {
      const { systemPrompt, messages, allTools, wrappedModel } =
        this.prepareLLM(options.instruction);

      const result = this.llmClient.streamText({
        model: wrappedModel,
        system: systemPrompt,
        messages,
        tools: allTools,
        stopWhen: stepCountIs(maxSteps),
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
              const args = toolCall.input as Record<string, unknown>;

              if (event.text.length > 0) {
                collectedReasoning.push(event.text);
                this.logger({
                  category: "agent",
                  message: `reasoning: ${event.text}`,
                  level: 1,
                });
              }

              const mappedActions = this.buildActions({
                toolCallName: toolCall.toolName,
                args,
                reasoning: event.text || undefined,
                currentPageUrl,
              });

              actions.push(...mappedActions);
            }
            currentPageUrl = (await this.v3.context.awaitActivePage()).url();
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

      return result;
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

  private prepareLLM(instruction: string): {
    systemPrompt: string;
    messages: ModelMessage[];
    allTools: AgentTools & ToolSet;
    wrappedModel: LanguageModel;
  } {
    const systemPrompt = this.buildSystemPrompt(
      instruction,
      this.systemInstructions,
    );
    const tools = this.createTools();
    const allTools = { ...tools, ...this.mcpTools } as AgentTools & ToolSet;
    const messages: ModelMessage[] = [
      { role: "user", content: instruction },
    ];

    if (!this.llmClient?.getLanguageModel) {
      throw new Error(
        "V3AgentHandler requires an AISDK-backed LLM client. Ensure your model is configured like 'openai/gpt-4.1-mini'.",
      );
    }
    const baseModel = this.llmClient.getLanguageModel();
    const wrappedModel = wrapLanguageModel({
      model: baseModel,
      middleware: {
        transformParams: async ({ params }) => {
          const { processedPrompt } = processMessages(params);
          return { ...params, prompt: processedPrompt } as typeof params;
        },
      },
    });

    return { systemPrompt, messages, allTools, wrappedModel };
  }

  private buildActions(params: {
    toolCallName: string;
    toolResult?: unknown;
    args: Record<string, unknown>;
    reasoning?: string;
    currentPageUrl: string;
  }): AgentAction[] {
    const { toolCallName, toolResult, args, reasoning, currentPageUrl } =
      params;
    const mappedActions = mapToolResultToActions({
      toolCallName,
      toolResult,
      args,
      reasoning,
    });

    for (const action of mappedActions) {
      action.pageUrl = currentPageUrl;
      action.timestamp = Date.now();
    }

    return mappedActions;
  }
}

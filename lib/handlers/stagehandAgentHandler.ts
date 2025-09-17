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
import { processMessages } from "../agent/utils/messageProcessing";
import { createAgentTools } from "../agent/tools";
import { ToolSet } from "ai";
import { Stagehand } from "../index";

export class StagehandAgentHandler {
  private stagehand: Stagehand;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;

  constructor(
    stagehand: Stagehand,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    mcpTools?: ToolSet,
  ) {
    this.stagehand = stagehand;
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

    try {
      const systemPrompt = this.buildSystemPrompt(
        options.instruction,
        this.systemInstructions,
      );
      const tools = this.createTools();
      const allTools = { ...tools, ...this.mcpTools };
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
          this.logger({
            category: "agent",
            message: `Step finished: ${event.finishReason}`,
            level: 2,
          });

          if (event.toolCalls && event.toolCalls.length > 0) {
            for (let i = 0; i < event.toolCalls.length; i++) {
              const toolCall = event.toolCalls[i];
              const args = toolCall.args as Record<string, unknown>;

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
                  const closeReasoning = args.reasoning as string;
                  const allReasoning = collectedReasoning.join(" ");
                  finalMessage = closeReasoning
                    ? `${allReasoning} ${closeReasoning}`.trim()
                    : allReasoning || "Task completed successfully";
                }
              }

              // Get the tool result if available
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
                    ? (args?.taskComplete as boolean)
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
4. When the task is complete, use the "close" tool with taskComplete: true
5. If the task cannot be completed, use "close" with taskComplete: false

TOOLS OVERVIEW:
- screenshot: Take a compressed JPEG screenshot for quick visual context (use sparingly)
- ariaTree: Get an accessibility (ARIA) hybrid tree for full page context (preferred for understanding layout and elements)
- act: Perform a specific atomic action (click, type, etc.)
- extract: Extract structured data
- goto: Navigate to a URL
- wait/navback/refresh: Control timing and navigation
- scroll: Scroll the page x pixels up or down

STRATEGY:
- Prefer ariaTree to understand the page before acting; use screenshot for quick confirmation.
- Keep actions atomic and verify outcomes before proceeding.

For each action, provide clear reasoning about why you're taking that step.`;
  }

  private createTools() {
    return createAgentTools(this.stagehand, {
      executionModel: this.executionModel,
      logger: this.logger,
    });
  }
}

import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import { StagehandPage } from "../StagehandPage";
import { LLMClient } from "../llm/LLMClient";
import { CoreMessage, wrapLanguageModel } from "ai";
import { LanguageModel } from "ai";
// Removed redundant preprocessor; ContextManager now handles all compression
import { createAgentTools } from "../agent/tools";
import { ToolSet } from "ai";
import { injectDropdownConverter } from "../utils/dropdownConverter";
import { ContextManager } from "./contextManager";
import { randomUUID } from "crypto";

export class StagehandAgentHandler {
  private stagehandPage: StagehandPage;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;
  private contextManager: ContextManager;

  constructor(
    stagehandPage: StagehandPage,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    mcpTools?: ToolSet,
  ) {
    this.stagehandPage = stagehandPage;
    this.logger = logger;
    this.llmClient = llmClient;
    this.executionModel = executionModel;
    this.systemInstructions = systemInstructions;
    this.mcpTools = mcpTools;
    this.contextManager = new ContextManager(logger);
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const sessionId = randomUUID();
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
            const processedPrompt = await this.contextManager.processMessages(
              params.prompt,
              sessionId,
              this.llmClient,
            );
            return { ...params, prompt: processedPrompt };
          },
        },
      });

      await injectDropdownConverter(this.stagehandPage.page);
      this.logger({
        category: "agent",
        message: "Injected dropdown converter script",
        level: 2,
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

              const action: AgentAction = {
                type: toolCall.toolName,
                reasoning: event.text || undefined,
                taskCompleted:
                  toolCall.toolName === "close"
                    ? (args?.taskComplete as boolean)
                    : false,
                ...args,
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

      this.contextManager.clearSession(sessionId);

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
      this.contextManager.clearSession(sessionId);
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

the current date is ${new Date().toLocaleDateString()}. you may think it is different due to knowledge cutoff, but this is the actual date.

Be very intentional about your action. the initial instruction is very important, and slight variations of the actual goal, can lead to failures.
When the task is complete, do not seek more information, you have completed the task.

IMPORTANT GUIDELINES:
1. Always start by understanding the current page state
2. Use the screenshot tool to verify page state when needed
3. Use appropriate tools for each action
4. When the task is complete, use the "close" tool with taskComplete: true
5. If the task cannot be completed, use "close" with taskComplete: false


WHEN NAVIGATING
- if you are confident in the url, navigate directly to it. 
- if you are not confident in the url, use the search tool to find the url.


TOOLS OVERVIEW:
- screenshot: Take a compressed JPEG screenshot for quick visual context (use sparingly)
- ariaTree: Get an accessibility (ARIA) hybrid tree for full page context (preferred for understanding layout and elements)
- act: Perform a specific atomic action (click, type, etc.)
- extract: Extract structured data
- goto: Navigate to a URL
- wait/navback/refresh: Control timing and navigation
- scroll: Scroll the page x pixels up or down
- search: Perform a web search and returns results. Use this tool when you need information from the web or when you are unsure of the exact URL you want to navigate to. You should always use this tool over navigating to google, and searching within the page it is more reliable, and more efficient for web search tasks.

STRATEGY:
- Prefer ariaTree to understand the page before acting; use screenshot for quick confirmation.
- Keep actions atomic and verify outcomes before proceeding.

For each action, provide clear reasoning about why you're taking that step.

COMPLETION: 
<IMPORTANT>
when you complete the task, explain any information that was found that was relevant to the orignal task.

example: if you were asked for specific flights, list the flights you found, 
example: if you were asked for information about a product, list the product information you were asked for`;
  }

  private createTools() {
    return createAgentTools(this.stagehandPage, {
      executionModel: this.executionModel,
      logger: this.logger,
    });
  }
}

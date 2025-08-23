import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import { StagehandPage } from "../StagehandPage";
import { LLMClient } from "../llm/LLMClient";
import { CoreMessage, wrapLanguageModel } from "ai";
import { LanguageModel } from "ai";
import { AISdkClient } from "../llm/aisdk";
import { processMessages } from "../agent/utils/messageProcessing";
import { createAgentTools } from "../agent/tools";

export class StagehandAgentHandler {
  private stagehandPage: StagehandPage;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;

  constructor(
    stagehandPage: StagehandPage,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
  ) {
    this.stagehandPage = stagehandPage;
    this.logger = logger;
    this.llmClient = llmClient;
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    const maxSteps = options.maxSteps || 10;
    const actions: AgentAction[] = [];
    let finalMessage = "";
    let completed = false;

    try {
      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(options.instruction);

      // Create tools
      const tools = this.createTools();

      const messages: CoreMessage[] = [
        {
          role: "user",
          content:
            "Please complete the task according to the system instructions.",
        },
      ];

      if (!this.llmClient) {
        throw new Error(
          "LLM client is not initialized. Please ensure you have the required API keys set (e.g., OPENAI_API_KEY) and that the model configuration is correct.",
        );
      }

      // Get a real AI SDK LanguageModel from the AISdkClient
      if (!(this.llmClient instanceof AISdkClient)) {
        throw new Error(
          "StagehandAgentHandler requires an AISdk-backed LLM client. Ensure your model is configured like 'openai/gpt-4.1-mini' or another AISDK provider.",
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

      // Execute with generateText using the wrapped model
      const result = await this.llmClient.generateText({
        model: wrappedModel,
        system: systemPrompt,
        messages,
        tools,
        maxSteps,
        temperature: 0.7,
        toolChoice: "auto",
        onStepFinish: async (event) => {
          this.logger({
            category: "agent",
            message: `Step finished: ${event.finishReason}`,
            level: 2,
          });

          // Track tool calls as actions
          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const toolCall of event.toolCalls) {
              // Get the actual args based on the tool name
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const args = toolCall.args as any;

              if (toolCall.toolName === "close") {
                completed = true;
                if (args?.taskComplete) {
                  finalMessage =
                    args.reasoning || "Task completed successfully";
                }
              }

              actions.push({
                type: toolCall.toolName,
                reasoning: args?.reasoning,
                taskCompleted: args?.taskComplete,
                parameters: args?.parameters,
              });
            }
          }
        },
      });

      // Use the text from the result if no final message was set
      if (!finalMessage && result.text) {
        finalMessage = result.text;
      }

      return {
        success: completed,
        message: finalMessage || "Task execution completed",
        actions,
        completed,
        usage: result.usage
          ? {
              input_tokens: result.usage.promptTokens || 0,
              output_tokens: result.usage.completionTokens || 0,
              inference_time_ms: 0,
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

  private buildSystemPrompt(instruction: string): string {
    return `You are a web automation assistant using browser automation tools to accomplish the user's goal.

Your task: ${instruction}

You have access to various browser automation tools. Use them step by step to complete the task.

IMPORTANT GUIDELINES:
1. Always start by understanding the current page state
2. Take screenshots to verify page content when needed
3. Use appropriate tools for each action
4. When the task is complete, use the "close" tool with taskComplete: true
5. If the task cannot be completed, use "close" with taskComplete: false

For each action, provide clear reasoning about why you're taking that step.`;
  }

  private createTools() {
    const page = this.stagehandPage.page;
    return createAgentTools(page);
  }
}

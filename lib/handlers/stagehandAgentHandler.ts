import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import { StagehandPage } from "../StagehandPage";
import { LLMClient } from "../llm/LLMClient";
import { tool, CoreMessage } from "ai";
import { z } from "zod";
import { LanguageModel } from "ai";
import { AISdkClient } from "../llm/aisdk";

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
      const model: LanguageModel = this.llmClient.getLanguageModel();

      // Execute with generateText
      const result = await this.llmClient.generateText({
        model,
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

    return {
      goto: tool({
        description: "Navigate to a specific URL",
        parameters: z.object({
          reasoning: z.string().describe("Why you're navigating to this URL"),
          parameters: z.string().describe("The URL to navigate to"),
        }),
        execute: async ({ parameters }) => {
          await page.goto(parameters, { waitUntil: "load" });
          return { success: true, url: parameters };
        },
      }),

      act: tool({
        description: "Perform an action on the page (click, type, etc)",
        parameters: z.object({
          reasoning: z.string().describe("Why you're performing this action"),
          parameters: z
            .string()
            .describe("Description of the action to perform"),
        }),
        execute: async ({ parameters }) => {
          const [observeResult] = await page.observe(parameters);
          if (observeResult) {
            await page.act(observeResult);
            return { success: true, action: parameters };
          }
          return { success: false, error: "Could not find element" };
        },
      }),

      extract: tool({
        description: "Extract data from the page",
        parameters: z.object({
          reasoning: z.string().describe("Why you're extracting this data"),
          parameters: z
            .string()
            .nullable()
            .describe("What to extract, or null for all text"),
        }),
        execute: async ({ parameters }) => {
          if (!parameters) {
            const result = await page.extract();
            return { success: true, data: result.page_text };
          } else {
            const result = await page.extract(parameters);
            return { success: true, data: result };
          }
        },
      }),

      screenshot: tool({
        description: "Take a screenshot of the current page",
        parameters: z.object({
          reasoning: z.string().describe("Why you need a screenshot"),
        }),
        execute: async () => {
          const screenshot = await page.screenshot({
            type: "png",
            fullPage: false,
          });
          const base64 = screenshot.toString("base64");
          const url = page.url();
          return {
            success: true,
            screenshot: `data:image/png;base64,${base64}`,
            url,
          };
        },
      }),

      wait: tool({
        description: "Wait for a specified time",
        parameters: z.object({
          reasoning: z.string().describe("Why you need to wait"),
          parameters: z.string().describe("Time to wait in milliseconds"),
        }),
        execute: async ({ parameters }) => {
          const ms = parseInt(parameters);
          await page.waitForTimeout(ms);
          return { success: true, waited: ms };
        },
      }),

      navback: tool({
        description: "Navigate back to the previous page",
        parameters: z.object({
          reasoning: z.string().describe("Why you're going back"),
        }),
        execute: async () => {
          await page.goBack();
          return { success: true };
        },
      }),

      refresh: tool({
        description: "Refresh the current page",
        parameters: z.object({
          reasoning: z.string().describe("Why you're refreshing"),
        }),
        execute: async () => {
          await page.reload();
          return { success: true };
        },
      }),

      close: tool({
        description: "Complete the task and close",
        parameters: z.object({
          reasoning: z.string().describe("Summary of what was accomplished"),
          taskComplete: z
            .boolean()
            .describe("Whether the task was completed successfully"),
        }),
        execute: async ({ reasoning, taskComplete }) => {
          return { success: true, reasoning, taskComplete };
        },
      }),
    };
  }
}

import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import { OperatorSummary, operatorSummarySchema } from "@/types/operator";
import { ObserveResult } from "@/types/stagehand";
import { GenerateTextResult, ToolSet } from "ai/dist";
import { z } from "zod";
import { LLMParsedResponse } from "../inference";
import { ChatMessage, LLMClient } from "../llm/LLMClient";
import { buildOperatorSystemPrompt } from "../prompt";
import { StagehandPage } from "../StagehandPage";

// Extended ChatMessage interface to support tool calls
interface ExtendedChatMessage extends ChatMessage {
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export class StagehandOperatorHandler {
  private stagehandPage: StagehandPage;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private messages: ExtendedChatMessage[];
  private allTools: ToolSet;

  constructor(
    stagehandPage: StagehandPage,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    mcpTools: ToolSet,
  ) {
    this.stagehandPage = stagehandPage;
    this.logger = logger;
    this.llmClient = llmClient;
    this.messages = [];

    // Create Stagehand method tools with proper Zod schemas
    const stagehandTools: ToolSet = {
      act: {
        description:
          "Perform an action on the page. Use this to interact with elements like clicking buttons, typing text, or navigating.",
        parameters: z.object({
          action: z
            .string()
            .describe(
              "The action to perform. e.g. 'click on the submit button' or 'type [email] into the email input field and press enter'",
            ),
        }),
        execute: async (args: { action: string }) => {
          const [playwrightArguments] = await this.stagehandPage.page.observe(
            args.action,
          );
          await this.stagehandPage.page.act(playwrightArguments);
          return {
            success: true,
            action: args.action,
            result: `Successfully performed action: ${args.action}`,
          };
        },
      },
      extract: {
        description:
          "Extract data from the page. Use this to get information like text, links, or structured data.",
        parameters: z.object({
          instruction: z
            .string()
            .optional()
            .describe(
              "What data to extract. e.g. 'the title of the article' or 'all links on the page'. If you want to extract all text, leave this empty.",
            ),
        }),
        execute: async (args: { instruction?: string }) => {
          let extractionResult;
          if (!args.instruction) {
            const extractionResultObj = await this.stagehandPage.page.extract();
            extractionResult = extractionResultObj.page_text;
          } else {
            extractionResult = await this.stagehandPage.page.extract(
              args.instruction,
            );
          }
          return {
            success: true,
            instruction: args.instruction || "all page text",
            result: extractionResult,
          };
        },
      },
      goto: {
        description: "Navigate to a specific URL.",
        parameters: z.object({
          url: z
            .string()
            .describe("The URL to navigate to. e.g. 'https://www.google.com'"),
        }),
        execute: async (args: { url: string }) => {
          await this.stagehandPage.page.goto(args.url, { waitUntil: "load" });
          return {
            success: true,
            url: args.url,
            result: `Successfully navigated to ${args.url}`,
          };
        },
      },
      wait: {
        description: "Wait for a period of time in milliseconds.",
        parameters: z.object({
          milliseconds: z
            .number()
            .describe("The amount of time to wait in milliseconds"),
        }),
        execute: async (args: { milliseconds: number }) => {
          await this.stagehandPage.page.waitForTimeout(args.milliseconds);
          return {
            success: true,
            waitTime: args.milliseconds,
            result: `Waited for ${args.milliseconds} milliseconds`,
          };
        },
      },
      navback: {
        description:
          "Navigate back to the previous page. Do not use if you are already on the first page.",
        parameters: z.object({}),
        execute: async () => {
          await this.stagehandPage.page.goBack();
          return {
            success: true,
            result: "Successfully navigated back to the previous page",
          };
        },
      },
      refresh: {
        description: "Refresh the current page.",
        parameters: z.object({}),
        execute: async () => {
          await this.stagehandPage.page.reload();
          return {
            success: true,
            result: "Successfully refreshed the page",
          };
        },
      },
      close: {
        description:
          "Close the task and finish execution. Use this when the task is complete or cannot be achieved.",
        parameters: z.object({
          reason: z.string().describe("The reason for closing the task"),
          success: z
            .boolean()
            .describe("Whether the task was completed successfully"),
        }),
        execute: async (args: { reason: string; success: boolean }) => {
          return {
            success: true,
            reason: args.reason,
            taskCompleted: args.success,
            result: `Task closed: ${args.reason}`,
          };
        },
      },
    };

    // Combine Stagehand tools with MCP tools
    this.allTools = { ...stagehandTools, ...mcpTools };
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    this.messages = [buildOperatorSystemPrompt(options.instruction)];
    let completed = false;
    let currentStep = 0;
    const maxSteps = options.maxSteps || 10;
    const actions: AgentAction[] = [];

    while (!completed && currentStep < maxSteps) {
      const url = this.stagehandPage.page.url();

      if (!url || url === "about:blank") {
        this.messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "No page is currently loaded. The first step should be a 'goto' action to navigate to a URL.",
            },
          ],
        });
      } else {
        const screenshot = await this.stagehandPage.page.screenshot({
          type: "png",
          fullPage: false,
        });

        const base64Image = screenshot.toString("base64");

        let messageText = `Here is a screenshot of the current page (URL: ${url}):`;

        messageText = `Previous actions were: ${actions
          .map((action) => {
            let result: string = "";
            if (action.type === "act") {
              const args = action.playwrightArguments as ObserveResult;
              result = `Performed a "${args.method}" action ${args.arguments.length > 0 ? `with arguments: ${args.arguments.map((arg) => `"${arg}"`).join(", ")}` : ""} on "${args.description}"`;
            } else if (action.type === "extract") {
              result = `Extracted data: ${action.extractionResult}`;
            }
            return `[${action.type}] ${action.reasoning}. Result: ${result}`;
          })
          .join("\n")}\n\n${messageText}`;

        this.messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: messageText,
            },
            this.llmClient.type === "anthropic"
              ? {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: base64Image,
                  },
                  text: "the screenshot of the current page",
                }
              : {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${base64Image}` },
                },
          ],
        });
      }

      const result = await this.getNextStep(currentStep);

      if (result.method === "close") {
        completed = true;
      }

      actions.push({
        type: result.method,
        reasoning: result.reasoning,
        taskCompleted: result.taskComplete,
        parameters: result.parameters,
        playwrightArguments: result.playwrightArguments,
        extractionResult: result.extractionResult,
      });

      currentStep++;
    }

    return {
      success: true,
      message: await this.getSummary(options.instruction),
      actions,
      completed: actions[actions.length - 1].taskCompleted as boolean,
    };
  }

  private async getNextStep(currentStep: number): Promise<{
    method: string;
    reasoning: string;
    taskComplete: boolean;
    parameters?: string;
    playwrightArguments?: ObserveResult;
    extractionResult?: unknown;
  }> {
    const response = await this.llmClient.createChatCompletion<
      GenerateTextResult<ToolSet, string>
    >({
      options: {
        messages: this.messages as ChatMessage[],
        tools: this.allTools,
        tool_choice: "auto",
        requestId: `operator-step-${currentStep}`,
      },
      logger: this.logger,
    });

    // Check if the response contains tool calls
    const toolCalls = response.toolCalls;

    if (toolCalls && toolCalls.length > 0) {
      // Add the tool results to the conversation

      this.messages.push({
        role: "assistant",
        content:
          `The following tool calls were made in this step:\n\n` +
          toolCalls
            .map(
              (tc, idx) =>
                `#${idx + 1}: Tool "${tc.toolName}" was called with arguments: ${JSON.stringify(tc.args)}`,
            )
            .join("\n") +
          `\n\nRaw tool calls: ${JSON.stringify(toolCalls)}`,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.toolCallId,
          type: "function",
          function: {
            name: tc.toolName,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });

      // Check if any tool call was a close action
      for (const toolCall of toolCalls) {
        if (toolCall.toolName === "close") {
          const args = toolCall.args;
          return {
            method: "close",
            reasoning: args.reason,
            taskComplete: args.success,
          };
        }
      }

      // Get the next step after tool execution
      return this.getNextStep(currentStep);
    }

    // If no tool calls, treat as a close action
    return {
      method: "close",
      reasoning: "No tool calls made, closing task",
      taskComplete: false,
    };
  }

  private async executeToolCalls(
    toolCalls: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>,
  ): Promise<string> {
    const results: string[] = [];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      const tool = this.allTools[toolName];
      if (!tool) {
        results.push(`Tool ${toolName} not found`);
        continue;
      }

      try {
        // Execute the tool function
        const result = await tool.execute(toolArgs, {
          toolCallId: toolCall.id,
          messages: [],
        });
        results.push(JSON.stringify(result));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push(`Error executing tool ${toolName}: ${errorMessage}`);
      }
    }

    return results.join("\n");
  }

  private async getSummary(goal: string): Promise<string> {
    const { data: response } =
      (await this.llmClient.createChatCompletion<OperatorSummary>({
        options: {
          messages: [
            ...this.messages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Now use the steps taken to answer the original instruction of ${goal}.`,
                },
              ],
            },
          ],
          response_model: {
            name: "operatorSummarySchema",
            schema: operatorSummarySchema,
          },
          requestId: "operator-summary",
        },
        logger: this.logger,
      })) as LLMParsedResponse<OperatorSummary>;

    return response.answer;
  }
}

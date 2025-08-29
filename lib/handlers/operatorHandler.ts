import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import { OperatorSummary, operatorSummarySchema } from "@/types/operator";
import { ObserveResult } from "@/types/stagehand";
import { ToolSet } from "ai/dist";
import { z } from "zod";
import { appendSummary, writeTimestampedTxtFile } from "../inferenceLogUtils";
import { LLMParsedResponse } from "../inference";
import { ChatMessage, LLMClient, LLMResponse } from "../llm/LLMClient";
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
  private logInferenceToFile: boolean;

  constructor(
    stagehandPage: StagehandPage,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    mcpTools: ToolSet,
    logInferenceToFile: boolean = false,
  ) {
    this.stagehandPage = stagehandPage;
    this.logger = logger;
    this.llmClient = llmClient;
    this.messages = [];
    this.logInferenceToFile = logInferenceToFile;

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
    const toolsArray = Object.entries(this.allTools).map(([name, tool]) => ({
      type: "function" as const,
      name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    this.logger({
      category: "agent",
      message: `Available tools for step ${currentStep}: ${toolsArray.map((t) => t.name).join(", ")}`,
      level: 1,
    });

    const requestId = `operator-step-${currentStep}`;
    let callTimestamp = "";
    let callFile = "";
    if (this.logInferenceToFile) {
      const { fileName, timestamp } = writeTimestampedTxtFile(
        "agent_summary",
        "agent_call",
        {
          requestId,
          modelCall: "agent",
          messages: this.messages,
          tools: toolsArray,
        },
      );
      callFile = fileName;
      callTimestamp = timestamp;
    }

    const startTime = Date.now();
    const response = await this.llmClient.createChatCompletion<LLMResponse>({
      options: {
        messages: this.messages as ChatMessage[],
        tools: toolsArray,
        tool_choice: "required", // Force tool usage since operator expects tool calls
        requestId,
      },
      logger: this.logger,
    });
    const endTime = Date.now();

    // Extract tool calls from LLMResponse format
    const toolCalls =
      response.choices?.[0]?.message?.tool_calls?.map((tc) => ({
        toolCallId: tc.id,
        toolName: tc.function.name,
        args: (() => {
          try {
            return JSON.parse(tc.function.arguments);
          } catch (error) {
            this.logger({
              category: "agent",
              message: `Failed to parse tool call arguments: ${tc.function.arguments}. Error: ${error}`,
              level: 0,
            });
            return {};
          }
        })(),
      })) || [];

    const responseText = response.choices?.[0]?.message?.content || "";

    // Log the response if inference logging is enabled
    if (this.logInferenceToFile) {
      const { fileName } = writeTimestampedTxtFile(
        "agent_summary",
        "agent_response",
        {
          requestId,
          modelResponse: "agent",
          rawResponse: {
            text: responseText,
            toolCalls: toolCalls,
            usage: response.usage,
          },
        },
      );

      appendSummary("agent", {
        agent_inference_type: "agent",
        timestamp: callTimestamp,
        LLM_input_file: callFile,
        LLM_output_file: fileName,
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        inference_time_ms: endTime - startTime,
      });
    }

    this.logger({
      category: "agent",
      message: `LLM response - ${toolCalls?.length || 0}, Text: "${responseText || "none"}"`,
      level: 1,
    });

    if (toolCalls && toolCalls.length > 0) {
      // Add the assistant message with tool calls to the conversation
      this.messages.push({
        role: "assistant",
        content: responseText || "",
        tool_calls: toolCalls.map((tc) => ({
          id: tc.toolCallId,
          type: "function",
          function: {
            name: tc.toolName,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });

      // Execute each tool call and collect results
      const toolResults: string[] = [];
      for (const toolCall of toolCalls) {
        const toolName = toolCall.toolName;
        const toolArgs = toolCall.args;

        this.logger({
          category: "agent",
          message: `Executing tool call: ${toolName} with args: ${JSON.stringify(toolArgs)}`,
          level: 1,
        });

        const tool = this.allTools[toolName];
        if (!tool) {
          const errorMsg = `Tool ${toolName} not found`;
          this.logger({
            category: "agent",
            message: errorMsg,
            level: 0,
          });
          toolResults.push(errorMsg);
          continue;
        }

        try {
          // Execute the tool function
          const result = await tool.execute(toolArgs, {
            toolCallId: toolCall.toolCallId,
            messages: [],
          });
          const stringifiedResult = JSON.stringify(result, null, 2);
          this.logger({
            category: "agent",
            message: `Tool ${toolName} completed successfully. Result: ${stringifiedResult}`,
            level: 1,
          });
          toolResults.push(stringifiedResult);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorMsg = `Error executing tool ${toolName}: ${errorMessage}`;
          this.logger({
            category: "agent",
            message: errorMsg,
            level: 0,
          });
          toolResults.push(errorMsg);
        }
      }

      // Add tool results to the conversation as user messages
      for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        const toolResult = toolResults[i];

        // Ensure the text content is not empty for Anthropic API
        const resultText =
          toolResult && toolResult.trim()
            ? `Tool "${toolCall.toolName}" result:\n${toolResult}`
            : `Tool "${toolCall.toolName}" completed with no output.`;

        this.messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: resultText,
            },
          ],
          tool_call_id: toolCall.toolCallId,
        });
      }

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

    // If no tool calls, this is an error - the LLM should always use tools
    this.logger({
      category: "agent",
      message: `ERROR: LLM did not make any tool calls despite being required to. Response text: "${responseText}". This indicates a configuration issue.`,
      level: 0,
    });

    return {
      method: "close",
      reasoning: "No tool calls made - LLM failed to use required tools",
      taskComplete: false,
    };
  }

  private async getSummary(goal: string): Promise<string> {
    const requestId = "operator-summary";
    const summaryMessages = [
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
    ];

    let callTimestamp = "";
    let callFile = "";
    if (this.logInferenceToFile) {
      const { fileName, timestamp } = writeTimestampedTxtFile(
        "agent_summary",
        "agent_summary_call",
        {
          requestId,
          modelCall: "agent_summary",
          messages: summaryMessages,
        },
      );
      callFile = fileName;
      callTimestamp = timestamp;
    }

    const startTime = Date.now();
    const { data: response, usage } =
      (await this.llmClient.createChatCompletion<OperatorSummary>({
        options: {
          messages: summaryMessages as ChatMessage[],
          response_model: {
            name: "operatorSummarySchema",
            schema: operatorSummarySchema,
          },
          requestId,
        },
        logger: this.logger,
      })) as LLMParsedResponse<OperatorSummary>;
    const endTime = Date.now();

    if (this.logInferenceToFile) {
      const { fileName } = writeTimestampedTxtFile(
        "agent_summary",
        "agent_summary_response",
        {
          requestId,
          modelResponse: "agent_summary",
          rawResponse: response,
        },
      );

      appendSummary("agent", {
        agent_inference_type: "agent_summary",
        timestamp: callTimestamp,
        LLM_input_file: callFile,
        LLM_output_file: fileName,
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        inference_time_ms: endTime - startTime,
      });
    }

    return response.answer;
  }
}

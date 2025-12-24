import OpenAI from "openai";
import { LogLine } from "../types/public/logs";
import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
  ResponseInputItem,
  ResponseItem,
  ComputerCallItem,
  FunctionCallItem,
  SafetyCheck,
  SafetyConfirmationHandler,
} from "../types/public/agent";
import { ClientOptions } from "../types/public/model";
import { AgentClient } from "./AgentClient";
import {
  AgentScreenshotProviderError,
  StagehandClosedError,
} from "../types/public/sdkErrors";
import { ToolSet } from "ai";
import {
  SessionFileLogger,
  formatCuaPromptPreview,
  formatCuaResponsePreview,
} from "../flowLogger";
import { v7 as uuidv7 } from "uuid";

/**
 * Client for OpenAI's Computer Use Assistant API
 * This implementation uses the official OpenAI Responses API for Computer Use
 */
export class OpenAICUAClient extends AgentClient {
  private apiKey: string;
  private organization?: string;
  private baseURL: string;
  private client: OpenAI;
  public lastResponseId?: string;
  private currentViewport = { width: 1288, height: 711 };
  private actualScreenshotSize = { width: 1288, height: 711 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;
  private reasoningItems: Map<string, ResponseItem> = new Map();
  private environment: string = "browser"; // "browser", "mac", "windows", or "ubuntu"
  private tools?: ToolSet;
  private safetyConfirmationHandler?: SafetyConfirmationHandler;

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: ClientOptions,
    tools?: ToolSet,
  ) {
    super(type, modelName, userProvidedInstructions);

    // Process client options
    this.apiKey =
      (clientOptions?.apiKey as string) || process.env.OPENAI_API_KEY || "";
    this.baseURL = (clientOptions?.baseURL as string) || undefined;
    this.organization =
      (clientOptions?.organization as string) || process.env.OPENAI_ORG;

    // Get environment if specified
    if (
      clientOptions?.environment &&
      typeof clientOptions.environment === "string"
    ) {
      this.environment = clientOptions.environment;
    }

    // Store client options for reference
    this.clientOptions = {
      apiKey: this.apiKey,
    };

    if (this.baseURL) {
      this.clientOptions.baseURL = this.baseURL;
    }

    // Initialize the OpenAI client
    this.client = new OpenAI(this.clientOptions);

    this.tools = tools;
  }

  setViewport(width: number, height: number): void {
    this.currentViewport = { width, height };
  }

  public setScreenshotSize(width: number, height: number): void {
    this.actualScreenshotSize = { width, height };
  }

  setCurrentUrl(url: string): void {
    this.currentUrl = url;
  }

  setScreenshotProvider(provider: () => Promise<string>): void {
    this.screenshotProvider = provider;
  }

  setActionHandler(handler: (action: AgentAction) => Promise<void>): void {
    this.actionHandler = handler;
  }

  setTools(tools: ToolSet): void {
    this.tools = tools;
  }

  setSafetyConfirmationHandler(handler?: SafetyConfirmationHandler): void {
    this.safetyConfirmationHandler = handler;
  }

  /**
   * Execute a task with the OpenAI CUA
   * This is the main entry point for the agent
   * @implements AgentClient.execute
   */
  async execute(executionOptions: AgentExecutionOptions): Promise<AgentResult> {
    const { options, logger } = executionOptions;
    const { instruction } = options;
    const maxSteps = options.maxSteps || 10;

    let currentStep = 0;
    let completed = false;
    const actions: AgentAction[] = [];
    const messageList: string[] = [];
    let finalMessage = "";
    this.reasoningItems.clear(); // Clear any previous reasoning items

    // Start with the initial instruction
    let inputItems = this.createInitialInputItems(instruction);
    let previousResponseId: string | undefined = undefined;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalInferenceTime = 0;

    try {
      // Execute steps until completion or max steps reached
      while (!completed && currentStep < maxSteps) {
        logger({
          category: "agent",
          message: `Executing step ${currentStep + 1}/${maxSteps}`,
          level: 1,
        });

        const result = await this.executeStep(
          inputItems,
          previousResponseId,
          logger,
        );
        totalInputTokens += result.usage.input_tokens;
        totalOutputTokens += result.usage.output_tokens;
        totalInferenceTime += result.usage.inference_time_ms;

        // Add actions to the list
        actions.push(...result.actions);

        // Update completion status
        completed = result.completed;

        // Store the previous response ID for the next request
        previousResponseId = result.responseId;

        // Update the input items for the next step if we're continuing
        if (!completed) {
          inputItems = result.nextInputItems;
        }

        // Record any message for this step
        if (result.message) {
          messageList.push(result.message);
          finalMessage = result.message;
        }

        // Increment step counter
        currentStep++;
      }

      // Return the final result
      return {
        success: completed,
        actions,
        message: finalMessage,
        completed,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: totalInferenceTime,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger({
        category: "agent",
        message: `Error executing agent task: ${errorMessage}`,
        level: 0,
      });

      return {
        success: false,
        actions,
        message: `Failed to execute task: ${errorMessage}`,
        completed: false,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: totalInferenceTime,
        },
      };
    }
  }

  /**
   * Execute a single step of the agent
   * This coordinates the flow: Request → Get Action → Execute Action
   */
  async executeStep(
    inputItems: ResponseInputItem[],
    previousResponseId: string | undefined,
    logger: (message: LogLine) => void,
  ): Promise<{
    actions: AgentAction[];
    message: string;
    completed: boolean;
    nextInputItems: ResponseInputItem[];
    responseId: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      inference_time_ms: number;
    };
  }> {
    try {
      // Get response from the model
      const result = await this.getAction(inputItems, previousResponseId);
      const output = result.output;
      const responseId = result.responseId;
      const usage = {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        inference_time_ms: result.usage.inference_time_ms,
      };

      // Add any reasoning items to our map
      for (const item of output) {
        if (item.type === "reasoning") {
          this.reasoningItems.set(item.id, item);
          logger({
            category: "agent",
            message: `Reasoning: ${String(item.content || "")}`,
            level: 1,
          });
        }
      }

      // Extract actions from the output
      const stepActions: AgentAction[] = [];
      for (const item of output) {
        if (item.type === "computer_call" && this.isComputerCallItem(item)) {
          logger({
            category: "agent",
            message: `Found computer_call: ${item.action.type}, call_id: ${item.call_id}`,
            level: 2,
          });
          const action = this.convertComputerCallToAction(item);
          if (action) {
            stepActions.push(action);
            logger({
              category: "agent",
              message: `Converted computer_call to action: ${action.type}`,
              level: 2,
            });
          }
        } else if (
          item.type === "function_call" &&
          this.isFunctionCallItem(item)
        ) {
          logger({
            category: "agent",
            message: `Found function_call: ${item.name}, call_id: ${item.call_id}`,
            level: 2,
          });
          const action = this.convertFunctionCallToAction(item);
          if (action) {
            stepActions.push(action);
            logger({
              category: "agent",
              message: `Converted function_call to action: ${action.type}`,
              level: 2,
            });
          }
        }
      }

      // Extract message text
      let message = "";
      for (const item of output) {
        if (item.type === "message") {
          logger({
            category: "agent",
            message: `Found message block`,
            level: 2,
          });
          if (item.content && Array.isArray(item.content)) {
            for (const content of item.content) {
              if (content.type === "output_text" && content.text) {
                message += content.text + "\n";
                logger({
                  category: "agent",
                  message: `Message text: ${String(content.text || "")}`,
                  level: 1,
                });
              }
            }
          }
        }
      }

      // Take actions and get results
      const nextInputItems = await this.takeAction(output, logger);

      // Check if completed
      const completed =
        output.length === 0 ||
        output.every(
          (item) => item.type === "message" || item.type === "reasoning",
        );

      return {
        actions: stepActions,
        message: message.trim(),
        completed,
        nextInputItems,
        responseId,
        usage: usage,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger({
        category: "agent",
        message: `Error executing step: ${errorMessage}`,
        level: 0,
      });

      throw error;
    }
  }

  private isComputerCallItem(item: ResponseItem): item is ComputerCallItem {
    return (
      item.type === "computer_call" &&
      "call_id" in item &&
      "action" in item &&
      typeof item.action === "object"
    );
  }

  private async handleSafetyConfirmation(
    pendingSafetyChecks: SafetyCheck[],
    logger: (message: LogLine) => void,
  ): Promise<SafetyCheck[] | undefined> {
    if (this.safetyConfirmationHandler) {
      logger({
        category: "agent",
        message: `Requesting safety confirmation for ${pendingSafetyChecks.length} check(s): ${pendingSafetyChecks.map((c) => c.code).join(", ")}`,
        level: 1,
      });

      const response =
        await this.safetyConfirmationHandler(pendingSafetyChecks);

      if (response.acknowledged) {
        logger({
          category: "agent",
          message: `Safety checks acknowledged by user`,
          level: 1,
        });
        return pendingSafetyChecks;
      } else {
        logger({
          category: "agent",
          message: `Safety checks rejected by user`,
          level: 1,
        });
        return undefined;
      }
    }

    logger({
      category: "agent",
      message: `Auto-acknowledging ${pendingSafetyChecks.length} safety check(s)`,
      level: 2,
    });
    return pendingSafetyChecks;
  }

  private isFunctionCallItem(item: ResponseItem): item is FunctionCallItem {
    return (
      item.type === "function_call" &&
      "call_id" in item &&
      "name" in item &&
      "arguments" in item
    );
  }

  private createInitialInputItems(instruction: string): ResponseInputItem[] {
    // For the initial request, we use a simple array with the user's instruction
    return [
      {
        role: "system",
        content: this.userProvidedInstructions,
      },
      {
        role: "user",
        content: instruction,
      },
    ];
  }

  async getAction(
    inputItems: ResponseInputItem[],
    previousResponseId?: string,
  ): Promise<{
    output: ResponseItem[];
    responseId: string;
    usage: Record<string, number>;
  }> {
    try {
      // Create the request parameters
      const requestParams: Record<string, unknown> = {
        model: this.modelName,
        tools: [
          {
            type: "computer_use_preview",
            display_width: this.currentViewport.width,
            display_height: this.currentViewport.height,
            environment: this.environment,
          },
        ],
        input: inputItems,
        truncation: "auto",
      };

      // Add custom tools if available
      if (this.tools && Object.keys(this.tools).length > 0) {
        const customTools = Object.entries(this.tools).map(([name, tool]) => ({
          type: "function" as const,
          name,
          function: {
            name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }));

        requestParams.tools = [
          ...(requestParams.tools as Record<string, unknown>[]),
          ...customTools,
        ];
      }

      // Add previous_response_id if available
      if (previousResponseId) {
        requestParams.previous_response_id = previousResponseId;
      }

      // Log LLM request
      const llmRequestId = uuidv7();
      SessionFileLogger.logLlmRequest({
        requestId: llmRequestId,
        model: this.modelName,
        operation: "CUA.getAction",
        prompt: formatCuaPromptPreview(inputItems),
      });

      const startTime = Date.now();
      // Create the response using the OpenAI Responses API
      // @ts-expect-error - Force type to match what the OpenAI SDK expects
      const response = await this.client.responses.create(requestParams);
      const endTime = Date.now();
      const elapsedMs = endTime - startTime;

      // Extract only the input_tokens and output_tokens
      const usage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        inference_time_ms: elapsedMs,
      };

      // Log LLM response
      SessionFileLogger.logLlmResponse({
        requestId: llmRequestId,
        model: this.modelName,
        operation: "CUA.getAction",
        output: formatCuaResponsePreview(response.output),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      // Store the response ID for future use
      this.lastResponseId = response.id;

      // Return the output and response ID
      return {
        output: response.output as unknown as ResponseItem[],
        responseId: response.id,
        usage,
      };
    } catch (error) {
      console.error("Error getting action from OpenAI:", error);
      throw error;
    }
  }

  async takeAction(
    output: ResponseItem[],
    logger: (message: LogLine) => void,
  ): Promise<ResponseInputItem[]> {
    const nextInputItems: ResponseInputItem[] = [];

    // Process each output item
    for (const item of output) {
      if (item.type === "computer_call" && this.isComputerCallItem(item)) {
        // Handle computer calls
        try {
          const action = this.convertComputerCallToAction(item);

          if (action && this.actionHandler) {
            logger({
              category: "agent",
              message: `Executing computer action: ${action.type}`,
              level: 1,
            });
            await this.actionHandler(action);
          }

          // Capture a screenshot
          const screenshot = await this.captureScreenshot();

          // Create a computer_call_output for the next request
          const outputItem = {
            type: "computer_call_output" as const,
            call_id: item.call_id,
            output: {
              type: "input_image" as const,
              image_url: screenshot,
            },
          } as ResponseInputItem;

          logger({
            category: "agent",
            message: `Added computer_call_output for call_id: ${item.call_id}`,
            level: 2,
          });

          // Add current URL if available
          if (this.currentUrl) {
            const computerCallOutput = outputItem as {
              type: "computer_call_output";
              call_id: string;
              output: {
                type: "input_image";
                image_url: string;
                current_url?: string;
              };
              acknowledged_safety_checks?: SafetyCheck[];
            };
            computerCallOutput.output.current_url = this.currentUrl;
          }

          if (
            item.pending_safety_checks &&
            item.pending_safety_checks.length > 0
          ) {
            const acknowledgedChecks = await this.handleSafetyConfirmation(
              item.pending_safety_checks,
              logger,
            );

            if (acknowledgedChecks) {
              const computerCallOutput = outputItem as {
                type: "computer_call_output";
                call_id: string;
                output: {
                  type: "input_image";
                  image_url: string;
                };
                acknowledged_safety_checks?: SafetyCheck[];
              };
              computerCallOutput.acknowledged_safety_checks =
                acknowledgedChecks;
            }
          }

          nextInputItems.push(outputItem);
        } catch (error) {
          if (error instanceof StagehandClosedError) {
            throw error;
          }
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          logger({
            category: "agent",
            message: `Error executing computer call: ${errorMessage}`,
            level: 0,
          });

          try {
            // Capture a screenshot even on error
            const screenshot = await this.captureScreenshot();

            const errorOutputItem = {
              type: "computer_call_output" as const,
              call_id: item.call_id,
              output: {
                type: "input_image" as const,
                image_url: screenshot,
                error: errorMessage,
              },
            } as ResponseInputItem;

            // Add current URL if available
            if (this.currentUrl) {
              const computerCallOutput = errorOutputItem as {
                type: "computer_call_output";
                call_id: string;
                output: {
                  type: "input_image";
                  image_url: string;
                  current_url?: string;
                };
                acknowledged_safety_checks?: SafetyCheck[];
              };
              computerCallOutput.output.current_url = this.currentUrl;
            }

            if (
              item.pending_safety_checks &&
              item.pending_safety_checks.length > 0
            ) {
              const acknowledgedChecks = await this.handleSafetyConfirmation(
                item.pending_safety_checks,
                logger,
              );

              if (acknowledgedChecks) {
                const computerCallOutput = errorOutputItem as {
                  type: "computer_call_output";
                  call_id: string;
                  output: {
                    type: "input_image";
                    image_url: string;
                  };
                  acknowledged_safety_checks?: SafetyCheck[];
                };
                computerCallOutput.acknowledged_safety_checks =
                  acknowledgedChecks;
              }
            }

            nextInputItems.push(errorOutputItem);
          } catch (screenshotError) {
            if (screenshotError instanceof StagehandClosedError) {
              throw screenshotError;
            }
            // If we can't capture a screenshot, just send the error
            logger({
              category: "agent",
              message: `Error capturing screenshot: ${String(screenshotError)}`,
              level: 0,
            });

            // For error cases without a screenshot, we need to use a string output
            nextInputItems.push({
              type: "computer_call_output",
              call_id: item.call_id,
              output: `Error: ${errorMessage}`,
            } as ResponseInputItem);
          }
        }
      } else if (
        item.type === "function_call" &&
        this.isFunctionCallItem(item)
      ) {
        // Handle function calls (tool calls)
        try {
          const action = this.convertFunctionCallToAction(item);

          if (action && this.actionHandler) {
            await this.actionHandler(action);
          }

          // Execute the tool if available
          let toolResult = "Tool executed successfully";
          if (this.tools && item.name in this.tools) {
            try {
              const tool = this.tools[item.name];
              const args = JSON.parse(item.arguments);

              logger({
                category: "agent",
                message: `Executing tool call: ${item.name} with args: ${item.arguments}`,
                level: 1,
              });

              const result = await tool.execute(args, {
                toolCallId: item.call_id,
                messages: [],
              });
              toolResult = JSON.stringify(result);

              logger({
                category: "agent",
                message: `Tool ${item.name} completed successfully. Result: ${toolResult}`,
                level: 1,
              });
            } catch (toolError) {
              const errorMessage =
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError);
              toolResult = `Error executing tool: ${errorMessage}`;

              logger({
                category: "agent",
                message: `Error executing tool ${item.name}: ${errorMessage}`,
                level: 0,
              });
            }
          }

          // Create a function_call_output for the next request
          const outputItem: ResponseInputItem = {
            type: "function_call_output",
            call_id: item.call_id,
            output: toolResult,
          };

          nextInputItems.push(outputItem);
        } catch (error) {
          if (error instanceof StagehandClosedError) {
            throw error;
          }
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          logger({
            category: "agent",
            message: `Error executing function call: ${errorMessage}`,
            level: 0,
          });

          // Send error result back
          const errorOutputItem: ResponseInputItem = {
            type: "function_call_output",
            call_id: item.call_id,
            output: `Error: ${errorMessage}`,
          };

          nextInputItems.push(errorOutputItem);
        }
      }
    }

    return nextInputItems;
  }

  private convertComputerCallToAction(
    call: ComputerCallItem,
  ): AgentAction | null {
    const { action } = call;

    // Scale coordinates from screenshot space to viewport space
    const scaledAction = { ...action };
    if (action.x !== undefined && action.y !== undefined) {
      const scaleX =
        this.currentViewport.width / this.actualScreenshotSize.width;
      const scaleY =
        this.currentViewport.height / this.actualScreenshotSize.height;
      scaledAction.x = Math.floor((action.x as number) * scaleX);
      scaledAction.y = Math.floor((action.y as number) * scaleY);
    }

    return {
      type: action.type as string,
      ...scaledAction,
    };
  }

  private convertFunctionCallToAction(
    call: FunctionCallItem,
  ): AgentAction | null {
    try {
      const args = JSON.parse(call.arguments);

      return {
        type: call.name,
        params: args,
      };
    } catch (error) {
      console.error("Error parsing function call arguments:", error);
      return null;
    }
  }

  async captureScreenshot(options?: {
    base64Image?: string;
    currentUrl?: string;
  }): Promise<string> {
    // Use provided options if available
    if (options?.base64Image) {
      return `data:image/png;base64,${options.base64Image}`;
    }

    // Use the screenshot provider if available
    if (this.screenshotProvider) {
      try {
        const base64Image = await this.screenshotProvider();
        return `data:image/png;base64,${base64Image}`;
      } catch (error) {
        console.error("Error capturing screenshot:", error);
        throw error;
      }
    }

    throw new AgentScreenshotProviderError(
      "`screenshotProvider` has not been set. " +
        "Please call `setScreenshotProvider()` with a valid function that returns a base64-encoded image",
    );
  }
}

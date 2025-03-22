import OpenAI from "openai";
import { LogLine } from "../../types/log";
import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
  ResponseInputItem,
  ResponseItem,
  ComputerCallItem,
  FunctionCallItem,
} from "@/types/agent";
import { AgentClient } from "./AgentClient";
import { AgentScreenshotProviderError } from "@/types/stagehandErrors";

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
  private currentViewport = { width: 1024, height: 768 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;
  private reasoningItems: Map<string, ResponseItem> = new Map();
  private environment: string = "browser"; // "browser", "mac", "windows", or "ubuntu"

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: Record<string, unknown>,
  ) {
    super(type, modelName, userProvidedInstructions);

    // Process client options
    this.apiKey =
      (clientOptions?.apiKey as string) || process.env.OPENAI_API_KEY || "";
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

    // Initialize the OpenAI client
    this.client = new OpenAI(this.clientOptions);
  }

  setViewport(width: number, height: number): void {
    this.currentViewport = { width, height };
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

    try {
      // Execute steps until completion or max steps reached
      while (!completed && currentStep < maxSteps) {
        logger({
          category: "agent",
          message: `Executing step ${currentStep + 1}/${maxSteps}`,
          level: 2,
        });

        const result = await this.executeStep(
          inputItems,
          previousResponseId,
          logger,
        );

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
  }> {
    try {
      // Get response from the model
      const result = await this.getAction(inputItems, previousResponseId);
      const output = result.output;
      const responseId = result.responseId;

      // Add any reasoning items to our map
      for (const item of output) {
        if (item.type === "reasoning") {
          this.reasoningItems.set(item.id, item);
        }
      }

      // Extract actions from the output
      const stepActions: AgentAction[] = [];
      for (const item of output) {
        if (item.type === "computer_call" && this.isComputerCallItem(item)) {
          const action = this.convertComputerCallToAction(item);
          if (action) {
            stepActions.push(action);
          }
        } else if (
          item.type === "function_call" &&
          this.isFunctionCallItem(item)
        ) {
          const action = this.convertFunctionCallToAction(item);
          if (action) {
            stepActions.push(action);
          }
        }
      }

      // Extract message text
      let message = "";
      for (const item of output) {
        if (item.type === "message") {
          if (item.content && Array.isArray(item.content)) {
            for (const content of item.content) {
              if (content.type === "output_text" && content.text) {
                message += content.text + "\n";
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

      // Add previous_response_id if available
      if (previousResponseId) {
        requestParams.previous_response_id = previousResponseId;
      }

      // Create the response using the OpenAI Responses API
      // @ts-expect-error - Force type to match what the OpenAI SDK expects
      const response = await this.client.responses.create(requestParams);

      // Store the response ID for future use
      this.lastResponseId = response.id;

      // Return the output and response ID
      return {
        output: response.output as unknown as ResponseItem[],
        responseId: response.id,
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

    // Add any computer calls to process
    for (const item of output) {
      if (item.type === "computer_call" && this.isComputerCallItem(item)) {
        // Execute the action
        try {
          const action = this.convertComputerCallToAction(item);

          if (action && this.actionHandler) {
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
              acknowledged_safety_checks?: Array<{
                id: string;
                code: string;
                message: string;
              }>;
            };
            computerCallOutput.output.current_url = this.currentUrl;
          }

          // Add any safety checks that need to be acknowledged
          if (
            item.pending_safety_checks &&
            item.pending_safety_checks.length > 0
          ) {
            const computerCallOutput = outputItem as {
              type: "computer_call_output";
              call_id: string;
              output: {
                type: "input_image";
                image_url: string;
              };
              acknowledged_safety_checks?: Array<{
                id: string;
                code: string;
                message: string;
              }>;
            };
            computerCallOutput.acknowledged_safety_checks =
              item.pending_safety_checks;
          }

          nextInputItems.push(outputItem);
        } catch (error) {
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
                acknowledged_safety_checks?: Array<{
                  id: string;
                  code: string;
                  message: string;
                }>;
              };
              computerCallOutput.output.current_url = this.currentUrl;
            }

            // Add any safety checks that need to be acknowledged
            if (
              item.pending_safety_checks &&
              item.pending_safety_checks.length > 0
            ) {
              const computerCallOutput = errorOutputItem as {
                type: "computer_call_output";
                call_id: string;
                output: {
                  type: "input_image";
                  image_url: string;
                };
                acknowledged_safety_checks?: Array<{
                  id: string;
                  code: string;
                  message: string;
                }>;
              };
              computerCallOutput.acknowledged_safety_checks =
                item.pending_safety_checks;
            }

            nextInputItems.push(errorOutputItem);
          } catch (screenshotError) {
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
        // Execute the function
        try {
          const action = this.convertFunctionCallToAction(item);

          if (action && this.actionHandler) {
            await this.actionHandler(action);
          }

          // Add the result
          nextInputItems.push({
            type: "function_call_output",
            call_id: item.call_id,
            output: "success",
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          logger({
            category: "agent",
            message: `Error executing function call: ${errorMessage}`,
            level: 0,
          });

          nextInputItems.push({
            type: "function_call_output",
            call_id: item.call_id,
            output: `Error: ${errorMessage}`,
          });
        }
      }
    }

    return nextInputItems;
  }

  private convertComputerCallToAction(
    call: ComputerCallItem,
  ): AgentAction | null {
    const { action } = call;

    // Instead of wrapping the action in a params object, spread the action properties directly
    // This ensures properties like x, y, button, etc. are directly accessible on the AgentAction
    return {
      type: action.type as string,
      ...action, // Spread all properties from the action
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

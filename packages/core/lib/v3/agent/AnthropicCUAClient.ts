import {
  AgentAction,
  AgentResult,
  AgentType,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicTextBlock,
  AnthropicToolResult,
  AgentExecutionOptions,
  ToolUseItem,
} from "../types/public/agent.js";
import { LogLine } from "../types/public/logs.js";
import { ClientOptions } from "../types/public/model.js";
import {
  AgentScreenshotProviderError,
  StagehandClosedError,
} from "../types/public/sdkErrors.js";
import Anthropic from "@anthropic-ai/sdk";
import { ToolSet } from "ai";
import { AgentClient } from "./AgentClient.js";
import { compressConversationImages } from "./utils/imageCompression.js";
import { toJsonSchema } from "../zodCompat.js";
import type { StagehandZodSchema } from "../zodCompat.js";
import {
  SessionFileLogger,
  formatCuaPromptPreview,
  formatCuaResponsePreview,
} from "../flowLogger.js";
import { v7 as uuidv7 } from "uuid";

export type ResponseInputItem = AnthropicMessage | AnthropicToolResult;

/**
 * Client for Anthropic's Computer Use API
 * This implementation uses the official Anthropic Messages API for Computer Use
 */
export class AnthropicCUAClient extends AgentClient {
  private apiKey: string;
  private baseURL?: string;
  private client: Anthropic;
  public lastMessageId?: string;
  private currentViewport = { width: 1288, height: 711 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;
  private thinkingBudget: number | null = null;
  private tools?: ToolSet;

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
      (clientOptions?.apiKey as string) || process.env.ANTHROPIC_API_KEY || "";
    this.baseURL = (clientOptions?.baseURL as string) || undefined;

    // Get thinking budget if specified
    if (
      clientOptions?.thinkingBudget &&
      typeof clientOptions.thinkingBudget === "number"
    ) {
      this.thinkingBudget = clientOptions.thinkingBudget;
    }

    // Store client options for reference
    this.clientOptions = {
      apiKey: this.apiKey,
    };

    if (this.baseURL) {
      this.clientOptions.baseURL = this.baseURL;
    }

    // Initialize the Anthropic client
    this.client = new Anthropic(this.clientOptions);

    this.tools = tools;
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

  setTools(tools: ToolSet): void {
    this.tools = tools;
  }

  /**
   * Execute a task with the Anthropic CUA
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

    // Start with the initial instruction
    let inputItems: ResponseInputItem[] =
      this.createInitialInputItems(instruction);

    logger({
      category: "agent",
      message: `Starting Anthropic agent execution with instruction: ${instruction}`,
      level: 1,
    });

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

        const result = await this.executeStep(inputItems, logger);
        totalInputTokens += result.usage.input_tokens;
        totalOutputTokens += result.usage.output_tokens;
        totalInferenceTime += result.usage.inference_time_ms;

        // Add actions to the list
        if (result.actions.length > 0) {
          logger({
            category: "agent",
            message: `Step ${currentStep + 1} performed ${result.actions.length} actions`,
            level: 2,
          });
          actions.push(...result.actions);
        }

        // Update completion status
        completed = result.completed;

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

      logger({
        category: "agent",
        message: `Anthropic agent execution completed: ${completed}, with ${actions.length} total actions performed`,
        level: 1,
      });

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

  async executeStep(
    inputItems: ResponseInputItem[],
    logger: (message: LogLine) => void,
  ): Promise<{
    actions: AgentAction[];
    message: string;
    completed: boolean;
    nextInputItems: ResponseInputItem[];
    usage: {
      input_tokens: number;
      output_tokens: number;
      inference_time_ms: number;
    };
  }> {
    try {
      // Get response from the model
      const result = await this.getAction(inputItems);
      const content = result.content;
      const usage = {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        inference_time_ms: result.usage.inference_time_ms,
      };

      logger({
        category: "agent",
        message: `Received response with ${content.length} content blocks`,
        level: 2,
      });

      // Extract actions from the content
      const stepActions: AgentAction[] = [];
      const toolUseItems: ToolUseItem[] = [];
      let message = "";

      // Process content blocks to find tool use items and text content
      for (const block of content) {
        logger({
          category: "agent",
          message: `Processing block type: ${block.type}, id: ${block.id || "unknown"}`,
          level: 2,
        });

        if (block.type === "tool_use") {
          // Direct handling of tool_use type
          logger({
            category: "agent",
            message: `Found tool_use block: ${JSON.stringify(block)}`,
            level: 2,
          });

          // Cast to ToolUseItem and add to list
          const toolUseItem = block as ToolUseItem;
          toolUseItems.push(toolUseItem);

          logger({
            category: "agent",
            message: `Added tool_use item: ${toolUseItem.name}, action: ${JSON.stringify(toolUseItem.input)}`,
            level: 2,
          });

          // Convert tool use to action and add to actions list
          const action = this.convertToolUseToAction(toolUseItem);
          if (action) {
            logger({
              category: "agent",
              message: `Created action from tool_use: ${toolUseItem.name}, action: ${action.type}`,
              level: 2,
            });
            stepActions.push(action);
          } else if (this.tools && toolUseItem.name in this.tools) {
            stepActions.push({
              type: "custom_tool",
              tool: toolUseItem.name,
              input: toolUseItem.input,
            } as AgentAction);
          }
        } else if (block.type === "text") {
          // Safe to cast here since we've verified it's a text block
          const textBlock = block as unknown as AnthropicTextBlock;
          message += textBlock.text + "\n";

          logger({
            category: "agent",
            message: `Found text block: ${textBlock.text}`,
            level: 2,
          });
        } else {
          logger({
            category: "agent",
            message: `Found unknown block type: ${block.type}`,
            level: 2,
          });
        }
      }

      // Execute actions if an action handler is provided
      if (this.actionHandler && stepActions.length > 0) {
        for (const action of stepActions) {
          try {
            logger({
              category: "agent",
              message: `Executing action: ${action.type}`,
              level: 1,
            });
            await this.actionHandler(action);
          } catch (error) {
            if (error instanceof StagehandClosedError) {
              throw error;
            }
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            logger({
              category: "agent",
              message: `Error executing action ${action.type}: ${errorMessage}`,
              level: 0,
            });
          }
        }
      }

      // Create the assistant response message with all content blocks
      const assistantMessage: AnthropicMessage = {
        role: "assistant",
        content: content as unknown as AnthropicContentBlock[],
      };

      // Keep track of the conversation history by preserving all previous messages
      // and adding new messages at the end
      const nextInputItems: ResponseInputItem[] = [...inputItems];

      // Add the assistant message with tool_use blocks to the history
      compressConversationImages(nextInputItems);

      nextInputItems.push(assistantMessage);

      // Generate tool results and add them as a user message
      if (toolUseItems.length > 0) {
        const toolResults = await this.takeAction(toolUseItems, logger);

        if (toolResults.length > 0) {
          // Tool results are AnthropicToolResult[] which are compatible with AnthropicContentBlock[]
          const userToolResultsMessage: AnthropicMessage = {
            role: "user",
            content: toolResults as unknown as AnthropicContentBlock[],
          };
          nextInputItems.push(userToolResultsMessage);
        }
      }

      // The step is completed only if there were no tool_use items
      const completed = toolUseItems.length === 0;

      logger({
        category: "agent",
        message: `Step processed ${toolUseItems.length} tool use items, completed: ${completed}`,
        level: 2,
      });

      return {
        actions: stepActions,
        message: message.trim(),
        completed,
        nextInputItems,
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

  private createInitialInputItems(instruction: string): AnthropicMessage[] {
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

  async getAction(inputItems: ResponseInputItem[]): Promise<{
    content: AnthropicContentBlock[];
    id: string;
    usage: Record<string, number>;
  }> {
    try {
      // For the API request, we use the inputItems directly
      // These should already be properly formatted as a sequence of user/assistant messages
      const messages: AnthropicMessage[] = [];

      for (const item of inputItems) {
        if ("role" in item) {
          // Skip system messages as Anthropic requires system as a top-level parameter
          if (item.role !== "system") {
            messages.push(item);
          }
        }
        // Note: We don't need special handling for tool_result items here anymore
        // as they should already be properly wrapped in user messages
      }

      // Configure thinking capability if available
      const thinking = this.thinkingBudget
        ? { type: "enabled" as const, budget_tokens: this.thinkingBudget }
        : undefined;

      // Claude 4.6+ models require the newer computer_20251124 tool version
      const modelBase = this.modelName.includes("/")
        ? this.modelName.split("/")[1]
        : this.modelName;
      const shouldUseNewToolVersion = [
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-opus-4-5-20251101",
      ].includes(modelBase);

      const computerToolType = shouldUseNewToolVersion
        ? "computer_20251124"
        : "computer_20250124";
      const betaFlag = shouldUseNewToolVersion
        ? "computer-use-2025-11-24"
        : "computer-use-2025-01-24";

      // Create the request parameters
      const requestParams: Record<string, unknown> = {
        model: this.modelName,
        max_tokens: 4096,
        messages: messages,
        tools: [
          {
            type: computerToolType,
            name: "computer",
            display_width_px: this.currentViewport.width,
            display_height_px: this.currentViewport.height,
            display_number: 1,
          },
        ],
        betas: [betaFlag],
      };

      // Add custom tools if available
      if (this.tools && Object.keys(this.tools).length > 0) {
        const customTools = Object.entries(this.tools).map(([name, tool]) => {
          const schema = tool.inputSchema as StagehandZodSchema;

          // Convert Zod schema to proper JSON schema format for Anthropic
          const jsonSchema = toJsonSchema(schema) as {
            properties?: Record<string, unknown>;
            required?: string[];
          };

          const inputSchema = {
            type: "object",
            properties: jsonSchema.properties || {},
            required: jsonSchema.required || [],
          };

          return {
            name,
            description: tool.description,
            input_schema: inputSchema,
          };
        });

        requestParams.tools = [
          ...(requestParams.tools as Record<string, unknown>[]),
          ...customTools,
        ];
      }

      // Add system parameter if provided
      if (this.userProvidedInstructions) {
        requestParams.system = this.userProvidedInstructions;
      }

      // Add thinking parameter if available
      if (thinking) {
        requestParams.thinking = thinking;
      }

      // Log LLM request
      const llmRequestId = uuidv7();
      SessionFileLogger.logLlmRequest({
        requestId: llmRequestId,
        model: this.modelName,
        operation: "CUA.getAction",
        prompt: formatCuaPromptPreview(messages),
      });

      const startTime = Date.now();
      // Create the message using the Anthropic Messages API
      // @ts-expect-error - The Anthropic SDK types are stricter than what we need
      const response = await this.client.beta.messages.create(requestParams);
      const endTime = Date.now();
      const elapsedMs = endTime - startTime;
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
        output: formatCuaResponsePreview(response.content),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      // Store the message ID for future use
      this.lastMessageId = response.id;

      // Return the content and message ID
      return {
        // Cast the response content to our internal type
        content: response.content as unknown as AnthropicContentBlock[],
        id: response.id,
        usage,
      };
    } catch (error) {
      console.error("Error getting action from Anthropic:", error);
      throw error;
    }
  }

  async takeAction(
    toolUseItems: ToolUseItem[],
    logger: (message: LogLine) => void,
  ): Promise<AnthropicToolResult[]> {
    const toolResults: AnthropicToolResult[] = [];

    logger({
      category: "agent",
      message: `Taking action on ${toolUseItems.length} tool use items`,
      level: 2,
    });

    // Process each tool use item
    for (const item of toolUseItems) {
      try {
        logger({
          category: "agent",
          message: `Processing tool use: ${item.name}, id: ${item.id}, action: ${JSON.stringify(item.input)}`,
          level: 2,
        });

        // TODO: Normalize and migrate to agentHandler

        // For computer tool, capture screenshot and return image
        if (item.name === "computer") {
          // Get action type
          const action = item.input.action as string;
          logger({
            category: "agent",
            message: `Computer action type: ${action}`,
            level: 2,
          });

          // Capture a screenshot for the response
          const screenshot = await this.captureScreenshot();
          logger({
            category: "agent",
            message: `Screenshot captured, length: ${screenshot.length}`,
            level: 2,
          });

          // Create proper image content block for Anthropic
          const imageContent = [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshot.replace(/^data:image\/png;base64,/, ""),
              },
            },
          ];

          // Add current URL if available
          if (this.currentUrl) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: item.id,
              content: [
                ...imageContent,
                {
                  type: "text",
                  text: `Current URL: ${this.currentUrl}`,
                },
              ],
            });
          } else {
            toolResults.push({
              type: "tool_result",
              tool_use_id: item.id,
              content: imageContent,
            });
          }

          logger({
            category: "agent",
            message: `Added computer tool result for tool_use_id: ${item.id}`,
            level: 2,
          });
        } else {
          // Handle custom tools
          let toolResult = "Tool executed successfully";
          if (this.tools && item.name in this.tools) {
            try {
              const tool = this.tools[item.name];

              logger({
                category: "agent",
                message: `Executing tool call: ${item.name} with args: ${JSON.stringify(item.input)}`,
                level: 1,
              });

              const result = await tool.execute(item.input, {
                toolCallId: item.id,
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

          toolResults.push({
            type: "tool_result",
            tool_use_id: item.id,
            content: [
              {
                type: "text",
                text: toolResult,
              },
            ],
          });

          logger({
            category: "agent",
            message: `Added custom tool result for tool ${item.name}, tool_use_id: ${item.id}`,
            level: 2,
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        logger({
          category: "agent",
          message: `Error executing tool use: ${errorMessage}`,
          level: 0,
        });

        try {
          // For computer tool, try to capture a screenshot even on error
          if (item.name === "computer") {
            const screenshot = await this.captureScreenshot();

            toolResults.push({
              type: "tool_result",
              tool_use_id: item.id,
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: screenshot.replace(/^data:image\/png;base64,/, ""),
                  },
                },
                {
                  type: "text",
                  text: `Error: ${errorMessage}`,
                },
              ],
            });

            logger({
              category: "agent",
              message: `Added error tool result with screenshot for tool_use_id: ${item.id}`,
              level: 1,
            });
          } else {
            // For other tools, return an error message as a text content block
            toolResults.push({
              type: "tool_result",
              tool_use_id: item.id,
              content: [
                {
                  type: "text",
                  text: `Error: ${errorMessage}`,
                },
              ],
            });

            logger({
              category: "agent",
              message: `Added error tool result for tool_use_id: ${item.id}`,
              level: 1,
            });
          }
        } catch (screenshotError) {
          // If we can't capture a screenshot, just send the error
          logger({
            category: "agent",
            message: `Error capturing screenshot: ${String(screenshotError)}`,
            level: 0,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: item.id,
            content: [
              {
                type: "text",
                text: `Error: ${errorMessage}`,
              },
            ],
          });

          logger({
            category: "agent",
            message: `Added text error tool result for tool_use_id: ${item.id}`,
            level: 1,
          });
        }
      }
    }

    logger({
      category: "agent",
      message: `Prepared ${toolResults.length} tool results for next request`,
      level: 2,
    });

    return toolResults;
  }

  private convertToolUseToAction(item: ToolUseItem): AgentAction | null {
    try {
      const { name, input } = item;

      if (name === "computer") {
        // For computer actions, format according to the action type
        const action = input.action as string;

        if (!action) {
          console.warn("Missing action in tool use item:", item);
          return null;
        }

        // Handle different action types specifically
        if (action === "screenshot") {
          return {
            type: "screenshot",
            ...input,
          };
        } else if (action === "click") {
          return {
            type: "click",
            x: input.x as number,
            y: input.y as number,
            button: (input.button as string) || "left",
            ...input,
          };
        } else if (action === "type") {
          return {
            type: "type",
            text: input.text as string,
            ...input,
          };
        } else if (action === "keypress" || action === "key") {
          return {
            type: "keypress",
            keys: [input.text as string],
            ...input,
          };
        } else if (action === "double_click" || action === "doubleClick") {
          return {
            type: "doubleClick",
            x:
              (input.x as number) ||
              (input.coordinate ? (input.coordinate as number[])[0] : 0),
            y:
              (input.y as number) ||
              (input.coordinate ? (input.coordinate as number[])[1] : 0),
            ...input,
          };
        } else if (action === "scroll") {
          // Convert Anthropic's coordinate, scroll_amount and scroll_direction into scroll_x and scroll_y
          const x =
            (input.x as number) ||
            (input.coordinate ? (input.coordinate as number[])[0] : 0);
          const y =
            (input.y as number) ||
            (input.coordinate ? (input.coordinate as number[])[1] : 0);

          // Calculate scroll_x and scroll_y based on scroll_amount and scroll_direction
          let scroll_x = 0;
          let scroll_y = 0;

          const scrollAmount = (input.scroll_amount as number) || 5;
          const scrollMultiplier = 100; // Pixels per unit of scroll_amount

          if (input.scroll_direction) {
            const direction = input.scroll_direction as string;
            if (direction === "down") {
              scroll_y = scrollAmount * scrollMultiplier;
            } else if (direction === "up") {
              scroll_y = -scrollAmount * scrollMultiplier;
            } else if (direction === "right") {
              scroll_x = scrollAmount * scrollMultiplier;
            } else if (direction === "left") {
              scroll_x = -scrollAmount * scrollMultiplier;
            }
          } else {
            // Use direct scroll_x and scroll_y if provided
            scroll_x = (input.scroll_x as number) || 0;
            scroll_y = (input.scroll_y as number) || 0;
          }

          return {
            type: "scroll",
            x: x,
            y: y,
            scroll_x: scroll_x,
            scroll_y: scroll_y,
            ...input,
          };
        } else if (action === "move") {
          // Handle Anthropic's coordinate format
          const coordinates = input.coordinate as number[] | undefined;
          const x = coordinates ? coordinates[0] : (input.x as number) || 0;
          const y = coordinates ? coordinates[1] : (input.y as number) || 0;

          return {
            type: "move",
            x: x,
            y: y,
            ...input,
          };
        } else if (action === "drag" || action === "left_click_drag") {
          // Make sure path is properly formatted
          const path =
            (input.path as { x: number; y: number }[]) ||
            (input.coordinate
              ? [
                  {
                    x: (input.start_coordinate as number[])[0],
                    y: (input.start_coordinate as number[])[1],
                  },
                  {
                    x: (input.coordinate as number[])[0],
                    y: (input.coordinate as number[])[1],
                  },
                ]
              : []);

          return {
            type: "drag",
            path: path,
            ...input,
          };
        } else if (action === "wait") {
          return {
            type: "wait",
            ...input,
          };
        } else if (action === "left_click") {
          // Convert left_click to regular click
          const coordinates = input.coordinate as number[] | undefined;
          const x = coordinates ? coordinates[0] : (input.x as number) || 0;
          const y = coordinates ? coordinates[1] : (input.y as number) || 0;

          return {
            type: "click",
            x: x,
            y: y,
            button: "left",
            ...input,
          };
        } else {
          // For other computer actions, use the action type directly
          return {
            type: action,
            ...input,
          };
        }
      } else if (name === "str_replace_editor" || name === "bash") {
        // For editor or bash tools
        return {
          type: name,
          params: input,
        };
      } else if (this.tools && name in this.tools) {
        return null;
      }

      console.warn(`Unknown tool name: ${name}`);
      return null;
    } catch (error) {
      console.error("Error converting tool use to action:", error);
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

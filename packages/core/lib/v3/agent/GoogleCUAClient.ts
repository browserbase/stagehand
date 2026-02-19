import {
  GoogleGenAI,
  Content,
  Part,
  GenerateContentResponse,
  FunctionCall,
  GenerateContentConfig,
  Tool,
  GoogleGenAIOptions,
} from "@google/genai";
import { LogLine } from "../types/public/logs.js";
import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
  SafetyCheck,
  SafetyConfirmationHandler,
} from "../types/public/agent.js";
import { ClientOptions } from "../types/public/model.js";
import { AgentClient } from "./AgentClient.js";
import {
  AgentScreenshotProviderError,
  LLMResponseError,
  StagehandClosedError,
} from "../types/public/sdkErrors.js";
import { buildGoogleCUASystemPrompt } from "../../prompt.js";
import { compressGoogleConversationImages } from "./utils/imageCompression.js";
import { mapKeyToPlaywright } from "./utils/cuaKeyMapping.js";
import {
  executeGoogleCustomTool,
  isCustomTool,
  convertToolSetToFunctionDeclarations,
} from "./utils/googleCustomToolHandler.js";
import { ToolSet } from "ai";
import {
  SessionFileLogger,
  formatCuaPromptPreview,
  formatCuaResponsePreview,
} from "../flowLogger.js";
import { v7 as uuidv7 } from "uuid";

/**
 * Client for Google's Computer Use Assistant API
 * This implementation uses the Google Generative AI SDK for Computer Use
 */
export class GoogleCUAClient extends AgentClient {
  private apiKey: string;
  private client: GoogleGenAI;
  private currentViewport = { width: 1288, height: 711 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;
  private history: Content[] = [];
  private environment: "ENVIRONMENT_BROWSER" | "ENVIRONMENT_DESKTOP" =
    "ENVIRONMENT_BROWSER";
  private generateContentConfig: GenerateContentConfig;
  private tools?: ToolSet;
  private baseURL?: string;
  private safetyConfirmationHandler?: SafetyConfirmationHandler;
  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: ClientOptions,
    tools?: ToolSet,
  ) {
    super(type, modelName, userProvidedInstructions);

    this.tools = tools;
    // Process client options
    this.apiKey =
      (clientOptions?.apiKey as string) ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      "";
    this.baseURL = clientOptions?.baseURL as string | undefined;

    // Initialize the Google Generative AI client
    const genAIOptions: GoogleGenAIOptions = {
      apiKey: this.apiKey,
      ...(this.baseURL ? { httpOptions: { baseUrl: this.baseURL } } : {}),
    };
    this.client = new GoogleGenAI(genAIOptions);

    // Get environment if specified
    if (
      clientOptions?.environment &&
      typeof clientOptions.environment === "string"
    ) {
      this.environment = clientOptions.environment as typeof this.environment;
    }

    this.generateContentConfig = {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
      // systemInstruction: this.userProvidedInstructions
      //   ? { parts: [{ text: this.userProvidedInstructions }] }
      //   : { parts: [{ text: buildGoogleCUASystemPrompt() }] },
      tools: [
        {
          computerUse: {
            environment: this.environment,
          },
        } as Tool,
      ],
    };

    // Store client options for reference
    this.clientOptions = {
      apiKey: this.apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    };

    // Initialize tools if provided
    if (this.tools && Object.keys(this.tools).length > 0) {
      this.updateGenerateContentConfig();
    }
  }

  public setViewport(width: number, height: number): void {
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
    this.updateGenerateContentConfig();
  }

  setSafetyConfirmationHandler(handler?: SafetyConfirmationHandler): void {
    this.safetyConfirmationHandler = handler;
  }

  private async handleSafetyConfirmation(
    safetyDecision: unknown,
    logger: (message: LogLine) => void,
  ): Promise<string | undefined> {
    const safetyMessage =
      typeof safetyDecision === "object"
        ? JSON.stringify(safetyDecision, null, 2)
        : String(safetyDecision);

    const safetyChecks: SafetyCheck[] = [
      {
        id: "google-safety-decision",
        code: "safety_decision",
        message: safetyMessage,
      },
    ];

    if (this.safetyConfirmationHandler) {
      logger({
        category: "agent",
        message: `Requesting safety confirmation for Google safety decision: ${safetyMessage}`,
        level: 1,
      });

      const response = await this.safetyConfirmationHandler(safetyChecks);

      if (response.acknowledged) {
        logger({
          category: "agent",
          message: `Safety decision acknowledged by user`,
          level: 1,
        });
        return "true";
      } else {
        logger({
          category: "agent",
          message: `Safety decision rejected by user`,
          level: 1,
        });
        return undefined;
      }
    }

    logger({
      category: "agent",
      message: `Auto-acknowledging Google safety decision`,
      level: 2,
    });
    return "true";
  }

  /**
   * Update the generateContentConfig with current tools
   */
  private updateGenerateContentConfig(): void {
    const functionDeclarations =
      this.tools && Object.keys(this.tools).length > 0
        ? convertToolSetToFunctionDeclarations(this.tools)
        : [];

    this.generateContentConfig = {
      ...this.generateContentConfig,
      tools: [
        {
          computerUse: {
            environment: this.environment,
          },
          ...(functionDeclarations.length > 0 ? { functionDeclarations } : {}),
        } as Tool,
      ],
    };
  }

  /**
   * Execute a task with the Google CUA
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
    this.history = []; // Clear history for new execution

    // Start with the initial instruction
    await this.initializeHistory(instruction);

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

        const result = await this.executeStep(logger);
        totalInputTokens += result.usage.input_tokens;
        totalOutputTokens += result.usage.output_tokens;
        totalInferenceTime += result.usage.inference_time_ms;

        // Add actions to the list
        actions.push(...result.actions);

        // Update completion status
        completed = result.completed;

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
   * Initialize conversation history with the initial instruction
   */
  private async initializeHistory(instruction: string): Promise<void> {
    const parts: Part[] = [{ text: instruction }];

    // Note: The Python implementation doesn't include the initial screenshot
    // Following the same pattern here

    const systemPromptContent = this.userProvidedInstructions
      ? this.userProvidedInstructions
      : buildGoogleCUASystemPrompt().content;

    this.history = [
      {
        role: "user",
        parts: [
          {
            text: "System prompt: " + systemPromptContent,
          },
        ],
      },
      {
        role: "user",
        parts,
      },
    ];
  }

  /**
   * Execute a single step of the agent
   */
  async executeStep(logger: (message: LogLine) => void): Promise<{
    actions: AgentAction[];
    message: string;
    completed: boolean;
    usage: {
      input_tokens: number;
      output_tokens: number;
      inference_time_ms: number;
    };
  }> {
    try {
      const startTime = Date.now();

      // Compress images in conversation history before sending to the model
      const compressedResult = compressGoogleConversationImages(
        this.history,
        2,
      );
      const compressedHistory = compressedResult.items;

      // Use the SDK's generateContent method with retry logic (matching Python's get_model_response)
      const maxRetries = 5;
      const baseDelayS = 1;
      let lastError: Error | null = null;
      let response: GenerateContentResponse | null = null;

      // Log LLM request
      const llmRequestId = uuidv7();
      SessionFileLogger.logLlmRequest({
        requestId: llmRequestId,
        model: this.modelName,
        operation: "CUA.generateContent",
        prompt: formatCuaPromptPreview(compressedHistory),
      });

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // Add exponential backoff delay for retries
          if (attempt > 0) {
            const delay = baseDelayS * Math.pow(2, attempt) * 1000; // Convert to ms
            logger({
              category: "agent",
              message: `Generating content failed on attempt ${attempt + 1}. Retrying in ${delay / 1000} seconds...`,
              level: 2,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          // Use the SDK's generateContent method - following Python SDK pattern
          response = await this.client.models.generateContent({
            model: this.modelName,
            contents: compressedHistory,
            config: this.generateContentConfig,
          });

          // Check if we have valid response content
          if (!response.candidates || response.candidates.length === 0) {
            throw new LLMResponseError("agent", "Response has no candidates!");
          }

          const candidate = response.candidates[0];
          if (!candidate.content || !candidate.content.parts) {
            const reason = candidate.finishReason || "unknown";
            throw new LLMResponseError(
              "agent",
              `Response has no content (finish reason: ${reason})`,
            );
          }

          // Success - we have a valid response
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger({
            category: "agent",
            message: `API call error: ${lastError.message}`,
            level: 2,
          });

          // If this was the last attempt, throw the error
          if (attempt === maxRetries - 1) {
            logger({
              category: "agent",
              message: `Generating content failed after ${maxRetries} attempts.`,
              level: 0,
            });
            throw lastError;
          }
        }
      }

      if (!response) {
        throw (
          lastError || new Error("Failed to get response after all retries")
        );
      }

      const endTime = Date.now();
      const elapsedMs = endTime - startTime;
      const { usageMetadata } = response;

      // Log LLM response
      SessionFileLogger.logLlmResponse({
        requestId: llmRequestId,
        model: this.modelName,
        operation: "CUA.generateContent",
        output: formatCuaResponsePreview(response),
        inputTokens: usageMetadata?.promptTokenCount,
        outputTokens: usageMetadata?.candidatesTokenCount,
      });

      // Process the response
      const result = await this.processResponse(response, logger);

      // Add model response to history
      if (response.candidates && response.candidates[0]) {
        // Sanitize any out-of-range coordinates in function calls before adding to history
        const sanitizedContent = JSON.parse(
          JSON.stringify(response.candidates[0].content),
        );
        if (sanitizedContent.parts) {
          for (const part of sanitizedContent.parts) {
            if (part.functionCall?.args) {
              if (
                typeof part.functionCall.args.x === "number" &&
                part.functionCall.args.x > 999
              ) {
                part.functionCall.args.x = 999;
              }
              if (
                typeof part.functionCall.args.y === "number" &&
                part.functionCall.args.y > 999
              ) {
                part.functionCall.args.y = 999;
              }
            }
          }
        }
        this.history.push(sanitizedContent);
      }

      // Execute actions and collect function responses
      const functionResponses: Part[] = [];

      if (result.actions.length > 0) {
        let hasError = false;

        // Execute all actions
        for (let i = 0; i < result.actions.length; i++) {
          const action = result.actions[i];

          logger({
            category: "agent",
            message: `Executing action ${i + 1}/${result.actions.length}: ${action.type}`,
            level: 2,
          });

          // Special handling for open_web_browser - don't execute it
          if (action.type === "open_web_browser") {
            // Set pageUrl for open_web_browser since it doesn't go through action handler
            action.pageUrl = this.currentUrl;
            logger({
              category: "agent",
              message: "Skipping open_web_browser action",
              level: 2,
            });
          } else if (action.type === "custom_tool") {
            const toolName = action.name as string;
            const toolArgs = action.arguments as Record<string, unknown>;

            if (this.tools && toolName in this.tools) {
              const correspondingFunctionCall = result.functionCalls.find(
                (fc) => fc.name === toolName,
              );

              if (correspondingFunctionCall) {
                const executionResult = await executeGoogleCustomTool(
                  toolName,
                  toolArgs,
                  this.tools,
                  correspondingFunctionCall,
                  logger,
                );

                functionResponses.push(executionResult.functionResponse);

                if (!executionResult.success) {
                  hasError = true;
                }
              }
            }
          } else if (this.actionHandler) {
            try {
              await this.actionHandler(action);

              // Add a delay between actions to ensure they complete properly
              // Longer delay for typing actions to ensure fields are ready
              if (i < result.actions.length - 1) {
                const nextAction = result.actions[i + 1];
                const isTypingAction =
                  action.type === "type" || nextAction.type === "type";
                const delay = isTypingAction ? 500 : 200;
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            } catch (actionError) {
              if (actionError instanceof StagehandClosedError) {
                throw actionError;
              }
              logger({
                category: "agent",
                message: `Error executing action ${action.type}: ${actionError}`,
                level: 0,
              });
              hasError = true;
              // Continue processing other actions even if one fails
            }
          }
        }

        // Create function responses for computer use actions (non-custom tools)
        // We need exactly one response per function call, regardless of how many actions were generated
        if (result.functionCalls.length > 0 || hasError) {
          // Filter out custom tool function calls as they've already been handled
          const computerUseFunctionCalls = result.functionCalls.filter(
            (fc) => !isCustomTool(fc, this.tools),
          );

          if (computerUseFunctionCalls.length > 0) {
            try {
              logger({
                category: "agent",
                message: `Taking screenshot after executing ${result.actions.length} actions${hasError ? " (with errors)" : ""}`,
                level: 2,
              });

              const screenshot = await this.captureScreenshot();
              const base64Data = screenshot.replace(
                /^data:image\/png;base64,/,
                "",
              );

              // Create one function response for each computer use function call
              // Following Python SDK pattern: FunctionResponse with parts containing inline_data
              for (const functionCall of computerUseFunctionCalls) {
                let safetyAcknowledgement: string | undefined;
                if (functionCall.args?.safety_decision) {
                  safetyAcknowledgement = await this.handleSafetyConfirmation(
                    functionCall.args.safety_decision,
                    logger,
                  );
                }

                const functionResponsePart: Part = {
                  functionResponse: {
                    name: functionCall.name,
                    response: {
                      url: this.currentUrl || "",
                      ...(safetyAcknowledgement !== undefined
                        ? {
                            safety_acknowledgement: safetyAcknowledgement,
                          }
                        : {}),
                    },
                    parts: [
                      {
                        inlineData: {
                          mimeType: "image/png",
                          data: base64Data,
                        },
                      },
                    ],
                  },
                };
                functionResponses.push(functionResponsePart);
              }
            } catch (error) {
              logger({
                category: "agent",
                message: `Error capturing screenshot: ${error}`,
                level: 0,
              });
            }
          }
        }

        // Add all function responses to history in a single user message
        if (functionResponses.length > 0) {
          logger({
            category: "agent",
            message: `Adding ${functionResponses.length} function responses to history`,
            level: 2,
          });
          this.history.push({
            role: "user",
            parts: functionResponses,
          });
        }
      }

      return {
        actions: result.actions,
        message: result.message,
        completed: result.completed,
        usage: {
          input_tokens: usageMetadata?.promptTokenCount || 0,
          output_tokens: usageMetadata?.candidatesTokenCount || 0,
          inference_time_ms: elapsedMs,
        },
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

  /**
   * Process the response from Google's API
   */
  private async processResponse(
    response: GenerateContentResponse,
    logger: (message: LogLine) => void,
  ): Promise<{
    actions: AgentAction[];
    message: string;
    completed: boolean;
    functionCalls: FunctionCall[];
  }> {
    const actions: AgentAction[] = [];
    let message = "";
    const functionCalls: FunctionCall[] = [];

    if (!response.candidates || response.candidates.length === 0) {
      return {
        actions: [],
        message: "No candidates in response",
        completed: true,
        functionCalls: [],
      };
    }
    const candidate = response.candidates[0];

    // Log the raw response for debugging
    logger({
      category: "agent",
      message: `Raw response from Google: ${JSON.stringify(candidate.content, null, 2)}`,
      level: 2,
    });

    // Process all parts - Google can send multiple function calls
    for (const part of candidate.content.parts) {
      if (part.text) {
        message += part.text + "\n";
        logger({
          category: "agent",
          message: `Reasoning: ${part.text}`,
          level: 1,
        });
      }
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
        logger({
          category: "agent",
          message: `Found function call: ${part.functionCall.name} with args: ${JSON.stringify(part.functionCall.args)}`,
          level: 2,
        });

        // Convert function call to action(s)
        const action = this.convertFunctionCallToAction(part.functionCall);
        if (action) {
          // Special handling for type_text_at - we need to click first
          if (
            part.functionCall.name === "type_text_at" &&
            action.type === "type"
          ) {
            logger({
              category: "agent",
              message: `Adding action: ${JSON.stringify(action)}`,
              level: 2,
            });
            // First add a click action at the same coordinates
            actions.push({
              type: "click",
              x: action.x,
              y: action.y,
              button: "left",
            });

            // If clear_before_typing is true (default), add a select all
            if (action.clearBeforeTyping) {
              // Select all text in the field
              actions.push({
                type: "keypress",
                keys: ["ControlOrMeta+A"],
              });
              actions.push({
                type: "keypress",
                keys: ["Backspace"],
              });
            }

            // Then add the type action
            actions.push(action);
            if (action.pressEnter) {
              actions.push({
                type: "keypress",
                keys: ["Enter"],
              });
            }
          } else {
            actions.push(action);
          }
        } else {
          logger({
            category: "agent",
            message: `Warning: Could not convert function call ${part.functionCall.name} to action`,
            level: 1,
          });
        }
      }
    }

    // Log summary of what we found
    logger({
      category: "agent",
      message: `Found ${functionCalls.length} function calls, converted to ${actions.length} actions`,
      level: 2,
    });

    // Check if task is completed
    const completed =
      functionCalls.length === 0 ||
      (candidate.finishReason && candidate.finishReason !== "STOP");

    return {
      actions,
      message: message.trim(),
      completed,
      functionCalls,
    };
  }

  /**
   * Convert Google function call to Stagehand action
   */
  private convertFunctionCallToAction(
    functionCall: FunctionCall,
  ): AgentAction | null {
    const { name, args } = functionCall;

    if (!name || !args) {
      return null;
    }

    switch (name) {
      case "open_web_browser":
        return {
          type: "open_web_browser",
          timestamp: Date.now(),
        };

      case "click_at": {
        const { x, y } = this.normalizeCoordinates(
          args.x as number,
          args.y as number,
        );
        return {
          type: "click",
          x,
          y,
          button: args.button || "left",
        };
      }

      case "type_text_at": {
        const { x, y } = this.normalizeCoordinates(
          args.x as number,
          args.y as number,
        );
        // Google's type_text_at includes press_enter and clear_before_typing parameters
        const pressEnter = (args.press_enter as boolean) ?? false;
        const clearBeforeTyping = (args.clear_before_typing as boolean) ?? true;

        // For type_text_at, we need to click first then type
        // This matches the behavior expected by Google's CUA
        // We'll handle this in the executeStep method by converting to two actions
        return {
          type: "type",
          text: args.text as string,
          x,
          y,
          pressEnter,
          clearBeforeTyping,
        };
      }

      case "key_combination": {
        const keys = (args.keys as string)
          .split("+")
          .map((key: string) => key.trim())
          .map((key: string) => mapKeyToPlaywright(key));
        return {
          type: "keypress",
          keys,
        };
      }

      case "scroll_document": {
        const direction = (args.direction as string).toLowerCase();
        return {
          type: "keypress",
          keys: [direction === "up" ? "PageUp" : "PageDown"],
        };
      }

      case "scroll_at": {
        const { x, y } = this.normalizeCoordinates(
          args.x as number,
          args.y as number,
        );
        const direction = ((args.direction as string) || "down").toLowerCase();
        const magnitude =
          typeof args.magnitude === "number" ? (args.magnitude as number) : 800;

        let scroll_x = 0;
        let scroll_y = 0;
        if (direction === "up") {
          scroll_y = -magnitude;
        } else if (direction === "down") {
          scroll_y = magnitude;
        } else if (direction === "left") {
          scroll_x = -magnitude;
        } else if (direction === "right") {
          scroll_x = magnitude;
        } else {
          // Default to down if unknown direction
          scroll_y = magnitude;
        }

        return {
          type: "scroll",
          x,
          y,
          scroll_x,
          scroll_y,
        };
      }

      case "navigate":
        return {
          type: "goto",
          url: args.url as string,
        };

      case "go_back":
        return {
          type: "back",
        };

      case "go_forward":
        return {
          type: "forward",
        };

      case "wait_5_seconds":
        return {
          type: "wait",
          timeMs: 5000, // Google CUA waits for 5 seconds
        };

      case "hover_at": {
        const { x, y } = this.normalizeCoordinates(
          args.x as number,
          args.y as number,
        );
        return {
          type: "move",
          x,
          y,
        };
      }

      case "search":
        return {
          type: "goto",
          url: "https://www.google.com",
        };

      case "drag_and_drop": {
        const startPoint = this.normalizeCoordinates(
          args.x as number,
          args.y as number,
        );
        const endPoint = this.normalizeCoordinates(
          args.destination_x as number,
          args.destination_y as number,
        );
        return {
          type: "drag",
          path: [
            { x: startPoint.x, y: startPoint.y },
            { x: endPoint.x, y: endPoint.y },
          ],
        };
      }

      default:
        if (isCustomTool(functionCall, this.tools)) {
          return {
            type: "custom_tool",
            name,
            arguments: args,
            timestamp: Date.now(),
            pageUrl: this.currentUrl,
          };
        }
        console.warn(`Unsupported Google CUA function: ${name}`);
        return null;
    }
  }

  /**
   * Normalize coordinates from Google's 0-1000 range to viewport dimensions
   */
  private normalizeCoordinates(x: number, y: number): { x: number; y: number } {
    const clampedX = Math.min(999, Math.max(0, x));
    const clampedY = Math.min(999, Math.max(0, y));
    return {
      x: Math.floor((clampedX / 1000) * this.currentViewport.width),
      y: Math.floor((clampedY / 1000) * this.currentViewport.height),
    };
  }

  async captureScreenshot(options?: {
    base64Image?: string;
    currentUrl?: string;
  }): Promise<string> {
    // Update current URL if provided
    if (options?.currentUrl) {
      this.currentUrl = options.currentUrl;
    }

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

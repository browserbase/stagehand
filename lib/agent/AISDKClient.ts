import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
} from "@/types/agent";
import { AgentClient } from "./AgentClient";
import { createAgentTools } from "./tools";
import { Page } from "../../types/page";
import { Stagehand } from "../index";
import { AgentScreenshotProviderError } from "@/types/stagehandErrors";

/**
 * Client for AI SDK integration with Anthropic
 * This implementation uses the Vercel AI SDK with automatic tool execution
 */
export class AISDKClient extends AgentClient {
  private apiKey: string;
  private currentViewport = { width: 1024, height: 768 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;
  private stagehandInstance?: Stagehand;
  private page?: Page;

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: Record<string, unknown>,
  ) {
    super(type, modelName, userProvidedInstructions);

    // Get API key for Anthropic
    this.apiKey =
      (clientOptions?.apiKey as string) || process.env.ANTHROPIC_API_KEY || "";

    // Store client options for reference
    this.clientOptions = {
      apiKey: this.apiKey,
    };

    // Get Stagehand and Page instances from client options
    this.stagehandInstance = clientOptions?.stagehand as Stagehand | undefined;
    this.page = clientOptions?.page as Page | undefined;
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

  async captureScreenshot(options?: Record<string, unknown>): Promise<unknown> {
    if (!this.screenshotProvider) {
      throw new AgentScreenshotProviderError(
        "`screenshotProvider` has not been set. " +
          "Please call `setScreenshotProvider` before capturing screenshots.",
      );
    }
    const base64Screenshot = await this.screenshotProvider();
    return {
      base64: base64Screenshot,
      timestamp: Date.now(),
      pageUrl: this.currentUrl,
      ...options,
    };
  }

  /**
   * Build system prompt for the AI SDK agent
   */
  private buildSystemPrompt(userGoal: string): string {
    const currentDateTime = new Date().toLocaleString();
    const userInstructions = this.userProvidedInstructions
      ? `\n\nAdditional instructions from user: ${this.userProvidedInstructions}`
      : "";

    return `You are a helpful web automation assistant using Stagehand tools to accomplish the user's goal: ${userGoal}${userInstructions}

PRIMARY APPROACH:
1. THINK first - Use the think tool to analyze the goal, break down your approach, and communicate your plan to the user
2. Take ONE atomic step at a time toward completion

ACTION EXECUTION HIERARCHY:

STEP 1: UNDERSTAND THE PAGE
- Use getText to get complete page context before taking actions
- Use screenshot for visual confirmation when needed

STEP 2: TAKE ACTIONS
- Use navigate to go to URLs
- Use actClick to click on buttons, links, or any clickable elements
- Use actType to type text into input fields or text areas
- Use wait after actions that may cause navigation

STEP 3: VERIFY RESULTS
- Take screenshot to verify success when needed
- Use getText to confirm changes

Current viewport: ${this.currentViewport.width}x${this.currentViewport.height}
Current URL: ${this.currentUrl || "Not set"}
Current date and time: ${currentDateTime}`;
  }

  /**
   * Execute a task with the AI SDK
   * @implements AgentClient.execute
   */
  async execute(executionOptions: AgentExecutionOptions): Promise<AgentResult> {
    const { options, logger } = executionOptions;
    const { instruction } = options;
    const maxSteps = options.maxSteps || 10;

    logger({
      category: "agent",
      message: `AI SDK Client executing with model: ${this.modelName}`,
      level: 1,
    });

    // Ensure we have required instances
    if (!this.stagehandInstance || !this.page) {
      throw new Error(
        "Stagehand and Page instances must be provided in clientOptions",
      );
    }

    // Use Anthropic model
    const model = anthropic(this.modelName);

    const systemPrompt = this.buildSystemPrompt(instruction);
    const actions: AgentAction[] = [];
    let completed = false;
    let finalMessage = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const startTime = Date.now();

    try {
      logger({
        category: "agent",
        message: `Starting AI SDK agent execution with instruction: ${instruction}`,
        level: 2,
      });

      // Create tools with the page and stagehand instances
      const tools = createAgentTools(this.page, this.stagehandInstance);

      // Execute with AI SDK
      const result = await streamText({
        model,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: instruction,
          },
        ],
        maxSteps,
        tools,
        toolCallStreaming: false,
        onStepFinish: (event) => {
          const stepNumber =
            (event as Record<string, unknown>).stepIndex !== undefined
              ? ((event as Record<string, unknown>).stepIndex as number) + 1
              : actions.length + 1;

          logger({
            category: "agent",
            message: `Step ${stepNumber} completed`,
            level: 2,
          });

          // Track tool calls as actions
          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const toolCall of event.toolCalls) {
              const action: AgentAction = {
                type: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                args: toolCall.args,
              };
              actions.push(action);

              logger({
                category: "action",
                message: `Tool called: ${toolCall.toolName}`,
                level: 1,
                auxiliary: {
                  toolName: {
                    value: toolCall.toolName,
                    type: "string" as const,
                  },
                  toolCallId: {
                    value: toolCall.toolCallId,
                    type: "string" as const,
                  },
                },
              });
            }
          }

          // Track usage
          if (event.usage) {
            totalInputTokens += event.usage.promptTokens || 0;
            totalOutputTokens += event.usage.completionTokens || 0;
          }
        },
      });

      // Wait for the stream to complete and collect the final text
      let fullText = "";
      for await (const textPart of result.textStream) {
        fullText += textPart;
      }

      // Get the final message from the accumulated text
      finalMessage = fullText.trim() || "Task completed";
      completed = true;

      logger({
        category: "agent",
        message: "AI SDK agent execution completed successfully",
        level: 2,
      });

      return {
        success: true,
        message: finalMessage,
        actions,
        completed,
        metadata: {
          totalSteps: actions.length,
          modelUsed: this.modelName,
          provider: this.type,
        },
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: Date.now() - startTime,
        },
      };
    } catch (error) {
      logger({
        category: "agent",
        message: `AI SDK agent execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        level: 0,
      });

      return {
        success: false,
        message: `Execution failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        actions,
        completed: false,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

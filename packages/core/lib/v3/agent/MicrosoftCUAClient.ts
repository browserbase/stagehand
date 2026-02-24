import OpenAI from "openai";
import { LogLine } from "../types/public/logs.js";
import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
} from "../types/public/agent.js";
import { ClientOptions } from "../types/public/model.js";
import { AgentClient } from "./AgentClient.js";
import { AgentScreenshotProviderError } from "../types/public/sdkErrors.js";
import { mapKeyToPlaywright } from "./utils/cuaKeyMapping.js";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Message types for FARA agent
 */
interface FaraMessage {
  role: "system" | "user" | "assistant";
  content: string | FaraMessageContent[];
}

interface FaraMessageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string; // data:image/png;base64,...
  };
}

/**
 * FARA function call structure (parsed from XML tags)
 */
interface FaraFunctionCall {
  name: string; // Always "computer_use"
  arguments: {
    action: string;
    thoughts?: string;
    [key: string]: unknown;
  };
}

/**
 * Client for FARA (Function-based Autonomous Research Agent) by Microsoft
 * This implementation uses OpenAI-compatible API with XML-based tool calling
 */
export class MicrosoftCUAClient extends AgentClient {
  private apiKey: string;
  private baseURL: string;
  private client: OpenAI;
  private currentViewport = { width: 1288, height: 711 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;

  // Dual history system
  private conversationHistory: FaraMessage[] = []; // Conceptual flow
  private actionHistory: FaraMessage[] = []; // Raw model responses

  private maxImages: number = 3;
  private temperature: number = 0;
  private facts: string[] = [];

  // FARA-specific MLM processor config
  private readonly MLM_PROCESSOR_IM_CFG = {
    min_pixels: 3136,
    max_pixels: 12845056,
    patch_size: 14,
    merge_size: 2,
  };

  // Resized dimensions for model input
  private resizedViewport = { width: 1288, height: 711 };

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: ClientOptions,
  ) {
    super(type, modelName || "fara-7b", userProvidedInstructions);

    // Process client options
    this.apiKey =
      (clientOptions?.apiKey as string) ||
      process.env.AZURE_API_KEY ||
      process.env.FIREWORKS_API_KEY ||
      "";
    this.baseURL =
      (clientOptions?.baseURL as string) ||
      process.env.AZURE_ENDPOINT ||
      process.env.FIREWORKS_ENDPOINT ||
      "";

    // Store client options for reference
    this.clientOptions = {
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    };

    // Validate API key
    if (!this.apiKey || this.apiKey === "") {
      throw new Error(
        "API key is required. Please provide it via clientOptions.apiKey or AZURE_API_KEY or FIREWORKS_API_KEY environment variables.",
      );
    }

    // Initialize the OpenAI client (FARA uses OpenAI-compatible API)
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });

    // Max images to keep in history
    if (clientOptions?.maxImages !== undefined) {
      this.maxImages = clientOptions.maxImages as number;
    }

    // Temperature
    if (clientOptions?.temperature !== undefined) {
      this.temperature = clientOptions.temperature as number;
    }
  }

  setViewport(width: number, height: number): void {
    this.currentViewport = { width, height };
    // Compute resized viewport using smart_resize logic
    this.resizedViewport = this.smartResize(width, height);
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
   * Smart resize algorithm from FARA
   * Ensures dimensions are divisible by factor and within pixel limits
   */
  private smartResize(
    width: number,
    height: number,
  ): { width: number; height: number } {
    const { patch_size, merge_size, min_pixels, max_pixels } =
      this.MLM_PROCESSOR_IM_CFG;
    const factor = patch_size * merge_size;

    const roundByFactor = (num: number, f: number) => Math.round(num / f) * f;
    const ceilByFactor = (num: number, f: number) => Math.ceil(num / f) * f;
    const floorByFactor = (num: number, f: number) => Math.floor(num / f) * f;

    let h_bar = Math.max(factor, roundByFactor(height, factor));
    let w_bar = Math.max(factor, roundByFactor(width, factor));

    if (h_bar * w_bar > max_pixels) {
      const beta = Math.sqrt((height * width) / max_pixels);
      h_bar = floorByFactor(height / beta, factor);
      w_bar = floorByFactor(width / beta, factor);
    } else if (h_bar * w_bar < min_pixels) {
      const beta = Math.sqrt(min_pixels / (height * width));
      h_bar = ceilByFactor(height * beta, factor);
      w_bar = ceilByFactor(width * beta, factor);
    }

    return { width: w_bar, height: h_bar };
  }

  /**
   * Generate system prompt with tool description
   * Simplified to match Python's minimal approach
   */
  private generateSystemPrompt(): string {
    const { width, height } = this.resizedViewport;

    // Base prompt - Minimalist like Python
    let basePrompt = "You are a helpful assistant.";

    // Add user-provided instructions if available
    if (this.userProvidedInstructions) {
      basePrompt = `${basePrompt}\n\n${this.userProvidedInstructions}`;
    }

    // Tool description from FaraComputerUse
    const toolDescription = `Use a mouse and keyboard to interact with a computer, and take screenshots.
* This is an interface to a desktop GUI. You do not have access to a terminal or applications menu. You must click on desktop icons to start applications.
* Some applications may take time to start or process actions, so you may need to wait and take successive screenshots to see the results of your actions. E.g. if you click on Firefox and a window doesn't open, try wait and taking another screenshot.
* The screen's resolution is ${width}x${height}.
* Whenever you intend to move the cursor to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.
* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your cursor position so that the tip of the cursor visually falls on the element that you want to click.
* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.
* When a separate scrollable container prominently overlays the webpage, if you want to scroll within it, you typically need to mouse_move() over it first and then scroll().
* If a popup window appears that you want to close, if left_click() on the 'X' or close button doesn't work, try key(keys=['Escape']) to close it.
* On some search bars, when you type(), you may need to press_enter=False and instead separately call left_click() on the search button to submit the search query. This is especially true of search bars that have auto-suggest popups for e.g. locations
* For calendar widgets, you usually need to left_click() on arrows to move between months and left_click() on dates to select them; type() is not typically used to input dates there.`;

    // Tool parameters description
    const actionsDescription = `The action to perform. The available actions are:
* \`key\`: Performs key down presses on the arguments passed in order, then performs key releases in reverse order. Includes "Enter", "Alt", "Shift", "Tab", "Control", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Shift", etc.
* \`type\`: Type a string of text on the keyboard.
* \`mouse_move\`: Move the cursor to a specified (x, y) pixel coordinate on the screen.
* \`left_click\`: Click the left mouse button.
* \`scroll\`: Performs a scroll of the mouse scroll wheel.
* \`history_back\`: Go back to the previous page in the browser history.
* \`pause_and_memorize_fact\`: Pause and memorize a fact for future reference.
* \`visit_url\`: Visit a specified URL.
* \`web_search\`: Perform a web search with a specified query.
* \`wait\`: Wait specified seconds for the change to happen.
* \`terminate\`: Terminate the current task and report its completion status.`;

    // Tool JSON schema
    const toolSchema = {
      name: "computer_use",
      description: toolDescription,
      parameters: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            description: actionsDescription,
            enum: [
              "key",
              "type",
              "mouse_move",
              "left_click",
              "scroll",
              "visit_url",
              "web_search",
              "history_back",
              "pause_and_memorize_fact",
              "wait",
              "terminate",
            ],
          },
          keys: {
            type: "array",
            description: "Required only by `action=key`.",
          },
          text: {
            type: "string",
            description: "Required only by `action=type`.",
          },
          press_enter: {
            type: "boolean",
            description:
              "Whether to press the Enter key after typing. Required only by `action=type`.",
          },
          delete_existing_text: {
            type: "boolean",
            description:
              "Whether to delete existing text before typing. Required only by `action=type`.",
          },
          coordinate: {
            type: "array",
            description:
              "(x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates to move the mouse to. Required only by `action=left_click`, `action=mouse_move`, and `action=type`.",
          },
          pixels: {
            type: "number",
            description:
              "The amount of scrolling to perform. Positive values scroll up, negative values scroll down. Required only by `action=scroll`.",
          },
          fact: {
            type: "string",
            description:
              "The fact to remember for the future. Required only by `action=pause_and_memorize_fact`.",
          },
          time: {
            type: "number",
            description: "The seconds to wait. Required only by `action=wait`.",
          },
          status: {
            type: "string",
            description:
              "The status of the task. Required only by `action=terminate`.",
            enum: ["success", "failure"],
          },
        },
      },
    };

    // Format as FARA function calling template (FN_CALL_TEMPLATE format)
    const toolDescs = JSON.stringify(toolSchema, null, 2);
    const functionCallTemplate = `
You are provided with function signatures within <tools></tools> XML tags:
<tools>
${toolDescs}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{{"name": <function-name>, "arguments": <args-json-object>}}
</tool_call>`;

    return `${basePrompt}\n\n${functionCallTemplate}`;
  }

  /**
   * Parse thoughts and action from model response
   * FARA uses XML-based tool calling: <tool_call>\n{...}\n</tool_call>
   */
  private parseThoughtsAndAction(response: string): {
    thoughts: string;
    functionCall: FaraFunctionCall;
  } {
    try {
      const parts = response.split("<tool_call>\n");
      const thoughts = parts[0].trim();
      const actionText = parts[1].split("\n</tool_call>")[0].trim();

      let parsedAction;
      try {
        parsedAction = JSON.parse(actionText);
      } catch (jsonError) {
        // Fix common malformed JSON: double opening brackets {{"name": ...}}
        // This happens when the model adds an extra opening brace
        if (actionText.startsWith("{{") && actionText.endsWith("}")) {
          // Remove the extra opening brace
          const fixedText = actionText.slice(1);
          try {
            parsedAction = JSON.parse(fixedText);
          } catch (retryError) {
            throw new Error(
              `Failed to parse action text even after fixing double brackets. Original: ${actionText}. Fixed: ${fixedText}. Error: ${retryError}`,
              { cause: retryError },
            );
          }
        } else {
          throw new Error(
            `Failed to parse action text as JSON: ${actionText}. Error: ${jsonError}`,
            { cause: jsonError },
          );
        }
      }

      return {
        thoughts,
        functionCall: {
          name: parsedAction.name || "computer_use",
          arguments: {
            ...parsedAction.arguments,
            thoughts,
          },
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to parse FARA tool call from response: ${response}. Error: ${error}`,
        { cause: error },
      );
    }
  }

  /**
   * Convert FARA function call to Stagehand AgentAction
   */
  private convertFunctionCallToAction(
    functionCall: FaraFunctionCall,
  ): AgentAction {
    const args = functionCall.arguments;
    const action = args.action as string;

    // Transform coordinates from resized to original viewport
    const transformCoordinate = (coord: number[]): number[] => {
      if (!coord || coord.length !== 2) return coord;
      const [x, y] = coord;
      const scaleX = this.currentViewport.width / this.resizedViewport.width;
      const scaleY = this.currentViewport.height / this.resizedViewport.height;
      return [Math.round(x * scaleX), Math.round(y * scaleY)];
    };

    const baseAction = {
      type: action,
      reasoning: args.thoughts as string,
    };

    switch (action) {
      case "left_click": {
        const clickCoord = transformCoordinate(args.coordinate as number[]);
        return {
          ...baseAction,
          type: "click",
          x: clickCoord[0],
          y: clickCoord[1],
          button: "left" as const,
        };
      }

      case "mouse_move": {
        const moveCoord = transformCoordinate(args.coordinate as number[]);
        return {
          ...baseAction,
          type: "move",
          coordinate: moveCoord,
        };
      }

      case "type": {
        const typeCoord = args.coordinate
          ? transformCoordinate(args.coordinate as number[])
          : undefined;
        return {
          ...baseAction,
          text: args.text as string,
          ...(typeCoord && { x: typeCoord[0], y: typeCoord[1] }),
          press_enter:
            args.press_enter !== undefined
              ? (args.press_enter as boolean)
              : true,
          ...(args.delete_existing_text !== undefined && {
            delete_existing_text: args.delete_existing_text as boolean,
          }),
        };
      }

      case "key":
      case "keypress": {
        const keys = (args.keys as string[]) || [];
        // Normalize keys to Playwright format
        const normalizedKeys = keys.map((k) => mapKeyToPlaywright(k));
        return {
          ...baseAction,
          type: "keypress",
          keys: normalizedKeys,
        };
      }

      case "scroll": {
        const pixels = (args.pixels as number) || 0;
        // FARA: positive = scroll up, negative = scroll down
        // Convert to scroll_x/scroll_y
        return {
          ...baseAction,
          scroll_x: 0,
          scroll_y: -pixels, // Invert: negative pixels = scroll down
        };
      }

      case "visit_url": {
        let url = args.url as string;
        // Enhanced URL processing like Python
        if (
          !url.startsWith("https://") &&
          !url.startsWith("http://") &&
          !url.startsWith("file://") &&
          !url.startsWith("about:")
        ) {
          // If URL contains space, treat as search query
          if (url.includes(" ")) {
            url = `https://www.bing.com/search?q=${encodeURIComponent(url)}&FORM=QBLH`;
          } else {
            // Otherwise prefix with https://
            url = "https://" + url;
          }
        }
        return {
          ...baseAction,
          type: "goto",
          url,
        };
      }

      case "web_search": {
        // Convert web search to visit_url with Bing search
        const query = args.query as string;
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&FORM=QBLH`;
        return {
          ...baseAction,
          type: "goto",
          url: searchUrl,
        };
      }

      case "history_back":
        return {
          ...baseAction,
          type: "back",
        };

      case "wait": {
        // Support both 'time' and 'duration' parameters with default (matches Python)
        const durationSeconds =
          (args.time as number) || (args.duration as number) || 3.0;
        return {
          ...baseAction,
          timeMs: durationSeconds * 1000, // Convert seconds to ms
        };
      }

      case "pause_and_memorize_fact": {
        // Store the fact for future reference (matches Python)
        const fact = args.fact as string;
        this.facts.push(fact);
        return {
          ...baseAction,
          fact,
        };
      }

      case "terminate":
        return {
          ...baseAction,
          status: args.status as string,
        };

      default:
        return {
          ...baseAction,
          ...args,
        };
    }
  }

  /**
   * Capture a screenshot and return as base64 data URL
   */
  async captureScreenshot(): Promise<string> {
    if (!this.screenshotProvider) {
      throw new AgentScreenshotProviderError("Screenshot provider not set");
    }

    const base64Screenshot = await this.screenshotProvider();
    return `data:image/png;base64,${base64Screenshot}`;
  }

  /**
   * Remove old screenshots from history
   * Matches Python's maybe_remove_old_screenshots
   */
  private maybeRemoveOldScreenshots(
    history: FaraMessage[],
    includesCurrent: boolean = false,
  ): FaraMessage[] {
    if (this.maxImages <= 0) {
      return history;
    }

    const maxImages = includesCurrent ? this.maxImages : this.maxImages - 1;
    const newHistory: FaraMessage[] = [];
    let nImages = 0;

    // Iterate backwards
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];

      // Check if message has image
      let hasImage = false;
      if (Array.isArray(msg.content)) {
        hasImage = msg.content.some((c) => c.type === "image_url");
      }

      if (i === 0 && nImages >= maxImages) {
        // First message (task) - preserve text, remove image
        if (Array.isArray(msg.content)) {
          const newContent = msg.content.filter((c) => c.type !== "image_url");
          // If no content left, skip (unless it's the only message, but Python logic says continue)
          if (newContent.length === 0) {
            continue;
          }
          newHistory.push({ ...msg, content: newContent });
        } else {
          newHistory.push(msg);
        }
        continue;
      }

      if (hasImage) {
        if (nImages < maxImages) {
          newHistory.push(msg);
          nImages++;
        } else {
          // Remove image, keep text
          if (Array.isArray(msg.content)) {
            const newContent = msg.content.filter(
              (c) => c.type !== "image_url",
            );
            // If content becomes empty, we can skip this message entirely (unless it's meaningful text)
            // Python logic: if msg is None continue.
            if (newContent.length > 0) {
              newHistory.push({ ...msg, content: newContent });
            }
          } else {
            newHistory.push(msg);
          }
        }
      } else {
        newHistory.push(msg);
      }
    }

    return newHistory.reverse();
  }

  /**
   * Reconstruct history for API call
   * Merges conceptual chat history with raw action history
   */
  private reconstructHistory(): FaraMessage[] {
    const history: FaraMessage[] = [];
    let actionTurn = 0;

    for (let i = 0; i < this.conversationHistory.length; i++) {
      const m = this.conversationHistory[i];
      if (m.role === "assistant") {
        if (actionTurn >= this.actionHistory.length) {
          // Should not happen if synced correctly
          console.warn("OUT OF SYNC: Action history shorter than chat history");
          history.push(m);
        } else {
          history.push(this.actionHistory[actionTurn]);
          actionTurn++;
        }
      } else {
        history.push(m);
      }
    }

    return this.maybeRemoveOldScreenshots(history);
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    logger: (message: LogLine) => void,
    isFirstRound: boolean = false,
  ): Promise<{
    actions: AgentAction[];
    completed: boolean;
    usage: {
      input_tokens: number;
      output_tokens: number;
      inference_time_ms: number;
    };
  }> {
    // Capture screenshot
    const screenshotDataUrl = await this.captureScreenshot();

    // Update conversation history with new screenshot/message
    if (isFirstRound) {
      // First round: modify the last message (initial user instruction) to include screenshot
      const lastMessage =
        this.conversationHistory[this.conversationHistory.length - 1];
      if (lastMessage && lastMessage.role === "user") {
        const originalContent =
          typeof lastMessage.content === "string"
            ? lastMessage.content
            : (lastMessage.content.find((c) => c.type === "text")?.text ??
              "Start task");

        lastMessage.content = [
          {
            type: "image_url",
            image_url: { url: screenshotDataUrl },
          },
          {
            type: "text",
            text: originalContent,
          },
        ];
      }
    } else {
      // Subsequent rounds: add new user message with screenshot
      const userContent: FaraMessageContent[] = [
        {
          type: "image_url",
          image_url: { url: screenshotDataUrl },
        },
      ];

      // Add current URL if available
      let textPrompt =
        "Here is the next screenshot. Think about what to do next.";
      if (this.currentUrl) {
        const trimmedUrl =
          this.currentUrl.length > 100
            ? this.currentUrl.slice(0, 100) + "..."
            : this.currentUrl;
        textPrompt = `Current URL: ${trimmedUrl}\n${textPrompt}`;
      }

      userContent.push({
        type: "text",
        text: textPrompt,
      });

      this.conversationHistory.push({
        role: "user",
        content: userContent,
      });
    }

    // Reconstruct history for model call
    let history = this.reconstructHistory();

    // Prepend system prompt (generated fresh)
    const systemMessage: FaraMessage = {
      role: "system",
      content: this.generateSystemPrompt(),
    };
    history = [systemMessage, ...history];

    // Make API call
    logger({
      category: "agent",
      message: `Making API call to FARA model with ${history.length} messages`,
      level: 2,
    });

    const startTime = Date.now();
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: history as unknown as ChatCompletionMessageParam[],
        temperature: this.temperature,
      });
    } catch (apiError) {
      logger({
        category: "agent",
        message: `API call failed: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
        level: 0,
      });
      throw apiError;
    }
    const inferenceTime = Date.now() - startTime;

    logger({
      category: "agent",
      message: `API call completed in ${inferenceTime}ms`,
      level: 2,
    });

    const content = response.choices[0].message.content || "";
    const usage = response.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    // Add assistant response to both histories
    const assistantMsg: FaraMessage = {
      role: "assistant",
      content,
    };
    this.conversationHistory.push(assistantMsg);
    this.actionHistory.push(assistantMsg);

    logger({
      category: "agent",
      message: `Model response: ${content}`,
      level: 2,
    });

    // Parse tool call
    const { thoughts, functionCall } = this.parseThoughtsAndAction(content);

    logger({
      category: "agent",
      message: `Thoughts: ${thoughts}`,
      level: 2,
    });

    logger({
      category: "agent",
      message: `Action: ${JSON.stringify(functionCall.arguments)}`,
      level: 2,
    });

    // Convert to AgentAction
    const agentAction = this.convertFunctionCallToAction(functionCall);

    // Expand type action into multiple actions if it has coordinates
    const actions: AgentAction[] = [];
    if (
      agentAction.type === "type" &&
      typeof agentAction.x === "number" &&
      typeof agentAction.y === "number"
    ) {
      // First, click at the coordinates to focus the field
      actions.push({
        type: "click",
        x: agentAction.x,
        y: agentAction.y,
        button: "left",
      });

      // If delete_existing_text is true, clear the field first
      if (agentAction.delete_existing_text) {
        actions.push({
          type: "keypress",
          keys: ["Command+A"],
        });
        actions.push({
          type: "keypress",
          keys: ["Backspace"],
        });
      }

      // Add the type action (without coordinates since we already clicked)
      actions.push({
        type: "type",
        text: agentAction.text,
      });

      // If press_enter is true (default), press Enter after typing
      if (agentAction.press_enter !== false) {
        actions.push({
          type: "keypress",
          keys: ["Enter"],
        });
      }
    } else {
      // For all other actions, just add as-is
      actions.push(agentAction);
    }

    // Execute all actions if handler is available
    if (this.actionHandler && agentAction.type !== "terminate") {
      for (const action of actions) {
        await this.actionHandler(action);
      }
    }

    // Check if completed
    const completed = functionCall.arguments.action === "terminate";

    return {
      actions,
      completed,
      usage: {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        inference_time_ms: inferenceTime,
      },
    };
  }

  /**
   * Execute a task with the FARA CUA
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
    let finalMessage: string;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalInferenceTime = 0;

    // Initialize conversation with user instruction
    // System prompt is NOT added here, it's added dynamically in executeStep
    this.conversationHistory = [
      {
        role: "user",
        content: instruction,
      },
    ];
    this.actionHistory = [];

    try {
      // Execute steps until completion or max steps reached
      while (!completed && currentStep < maxSteps) {
        logger({
          category: "agent",
          message: `Executing step ${currentStep + 1}/${maxSteps}`,
          level: 1,
        });

        const isFirstRound = currentStep === 0;
        const result = await this.executeStep(logger, isFirstRound);
        totalInputTokens += result.usage.input_tokens;
        totalOutputTokens += result.usage.output_tokens;
        totalInferenceTime += result.usage.inference_time_ms;

        // Add actions to the list
        actions.push(...result.actions);

        // Update completion status
        completed = result.completed;

        currentStep++;

        // Record message for this step
        const lastAction = result.actions[result.actions.length - 1];
        if (lastAction?.reasoning) {
          messageList.push(lastAction.reasoning);
        }
      }

      // Generate final message
      if (completed) {
        const lastAction = actions[actions.length - 1];
        finalMessage =
          (lastAction as { status?: string })?.status === "success"
            ? "Task completed successfully."
            : "Task completed with failures.";
      } else {
        finalMessage = `Reached maximum steps (${maxSteps}) without completion.`;
      }

      if (messageList.length > 0) {
        finalMessage = `${messageList.join("\n\n")}\n\n${finalMessage}`;
      }

      return {
        success: completed,
        completed,
        message: finalMessage,
        actions,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: totalInferenceTime,
        },
      };
    } catch (error) {
      logger({
        category: "agent",
        message: `Error during execution: ${error}`,
        level: 0,
      });

      // Rethrow to allow eval runner's retry logic to handle transient errors
      throw error;
    }
  }
}

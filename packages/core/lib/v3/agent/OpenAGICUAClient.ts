import { Actor } from "@oagi/oagi";
import { AgentScreenshotProviderError } from "../types/public/sdkErrors";
import { AgentClient } from "./AgentClient";
import type { Action, Step } from "@oagi/oagi";
import type {
  AgentAction,
  AgentExecutionOptions,
  AgentResult,
  AgentType,
} from "../types/public/agent";
import type { ClientOptions } from "../types/public/model";

export class OpenAGICUAClient extends AgentClient {
  private apiKey: string;
  private baseURL: string;
  private currentViewport = { width: 1288, height: 711 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: ClientOptions,
  ) {
    super(type, modelName, userProvidedInstructions);

    // Process client options
    this.apiKey = clientOptions?.apiKey ?? process.env.OPENAGI_API_KEY ?? "";
    this.baseURL = clientOptions?.baseURL ?? undefined;
  }

  private denormalize(
    x: number | string,
    y: number | string,
  ): { x: number; y: number } {
    const { width, height } = this.currentViewport;

    let px = Math.floor((Number(x) * width) / 1000);
    let py = Math.floor((Number(y) * height) / 1000);

    if (px < 1) px = 1;
    if (px > width - 1) px = width - 1;
    if (py < 1) py = 1;
    if (py > height - 1) py = height - 1;

    return { x: px, y: py };
  }

  private convertAction(step: Step, action: Action): AgentAction {
    const reasoning = step.reason;
    const arg = action.argument.trim().replace(/^\(/, "").replace(/\)$/, "");
    switch (action.type) {
      case "click":
      case "left_double":
      case "left_triple":
      case "right_single": {
        const coords = /(\d+),\s*(\d+)/.exec(arg);
        if (!coords) throw new Error(`Invalid click coords: ${arg}`);
        return {
          type: {
            click: "click",
            left_double: "doubleClick",
            left_triple: "tripleClick",
            right_single: "click",
          }[action.type],
          ...this.denormalize(coords[1], coords[2]),
          button: action.type === "right_single" ? "right" : "left",
          clickCount: action.count,
          reasoning,
        };
      }
      case "drag": {
        const coords = /(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/.exec(arg);
        if (!coords) throw new Error(`Invalid drag coords: ${arg}`);
        return {
          type: "drag",
          path: [
            this.denormalize(coords[1], coords[2]),
            this.denormalize(coords[3], coords[4]),
          ],
          reasoning,
        };
      }
      case "hotkey": {
        const keys = arg
          .trim()
          .replace(/^\(|\)$/g, "")
          .split("+")
          .map((key) => {
            key = key.trim().toLowerCase();
            return (
              {
                caps_lock: "capslock",
                caps: "capslock",
                page_up: "pageup",
                pageup: "pageup",
                page_down: "pagedown",
                pagedown: "pagedown",
                cmd: "command",
                ctrl: "control",
              }[key] ?? key
            );
          })
          .filter(Boolean);
        return {
          type: "keypress",
          keys,
          reasoning,
        };
      }
      case "type":
        return {
          type: "type",
          text: arg.replace(/^['"]/, "").replace(/['"]$/, ""),
          reasoning,
        };
      case "scroll": {
        const match = /(\d+),\s*(\d+),\s*(\w+)/.exec(arg);
        if (!match) throw new Error(`Invalid scroll args: ${arg}`);
        let scroll_x = 0;
        let scroll_y = 0;
        switch (match[3].toLowerCase()) {
          case "right":
            scroll_x = 100;
            break;
          case "left":
            scroll_x = -100;
            break;
          case "down":
            scroll_y = 100;
            break;
          case "up":
            scroll_y = -100;
            break;
          default:
            throw new Error(
              `Invalid scroll direction: ${match[3].toLowerCase()}`,
            );
        }
        return {
          type: "scroll",
          ...this.denormalize(match[1], match[2]),
          scroll_x,
          scroll_y,
          reasoning,
        };
      }
      case "wait":
        return {
          type: "wait",
          timeMs: Number(arg) || 1000,
          reasoning,
        };
      case "finish":
      case "call_user":
        throw new Error(`Unimplemented action type: ${action.type}`);
      default:
        throw new Error(`Unknown action type: ${action.type satisfies never}`);
    }
  }

  /**
   * Execute a task with the OpenAGI CUA
   * This is the main entry point for the agent
   * @implements AgentClient.execute
   */
  async execute(executionOptions: AgentExecutionOptions): Promise<AgentResult> {
    const { options, logger } = executionOptions;
    const { instruction } = options;
    const maxSteps = options.maxSteps || 10;

    const actions: AgentAction[] = [];
    let completed = false;
    let message = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalInferenceTime = 0;

    const actor = new Actor(this.apiKey, this.baseURL, this.modelName);
    logger({
      category: "agent",
      message: `Starting task execution: ${instruction}`,
      level: 1,
    });
    actor.initTask(instruction, maxSteps);

    try {
      for (let i = 0; !completed && i < maxSteps; ++i) {
        logger({
          category: "agent",
          message: `Executing step ${i + 1}/${maxSteps}`,
          level: 2,
        });
        const image = await this.captureScreenshot();
        const buffer = Buffer.from(image.split(",")[1], "base64");
        const arraybuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        );
        const startTime = Date.now();
        const step = await actor.step(arraybuffer);
        totalInputTokens += step.usage.prompt_tokens;
        totalOutputTokens += step.usage.completion_tokens;
        totalInferenceTime += Date.now() - startTime;
        completed = step.stop;
        message = step.reason ?? "";
        if (step.reason) {
          logger({
            category: "agent",
            message: `Step ${i + 1}: ${step.reason}`,
            level: 2,
          });
        }
        if (step.actions.length) {
          logger({
            category: "agent",
            message: `Actions (${step.actions.length}):`,
            level: 2,
          });
          const acts = step.actions
            .filter((action) => action.type !== "finish")
            .map((action) => this.convertAction(step, action));
          actions.push(...acts);
          for (const action of acts) {
            logger({
              category: "agent",
              message: `  [${action.type}] ${action.argument}`,
              level: 2,
            });
          }
          for (const action of acts) {
            await this.actionHandler?.(action);
          }
        }
      }

      return {
        success: completed,
        actions,
        message,
        completed,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: totalInferenceTime,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
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
}

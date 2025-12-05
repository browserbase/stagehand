import { computeActiveElementXpath } from "../understudy/a11y/snapshot";
import { V3 } from "../v3";
import { ToolSet } from "ai";
import { AgentClient } from "../agent/AgentClient";
import { AgentProvider } from "../agent/AgentProvider";
import { mapKeyToPlaywright } from "../agent/utils/cuaKeyMapping";
import {
  ActionExecutionResult,
  AgentAction,
  AgentExecuteOptions,
  AgentHandlerOptions,
  AgentResult,
} from "../types/public/agent";
import { LogLine } from "../types/public/logs";
import { type Action, V3FunctionName } from "../types/public/methods";

export class V3CuaAgentHandler {
  private v3: V3;
  private agent: AgentClient;
  private provider: AgentProvider;
  private logger: (message: LogLine) => void;
  private agentClient: AgentClient;
  private options: AgentHandlerOptions;
  private highlightCursor: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private screenshotCollector?: any;

  constructor(
    v3: V3,
    logger: (message: LogLine) => void,
    options: AgentHandlerOptions,
    tools?: ToolSet,
  ) {
    this.v3 = v3;
    this.logger = logger;
    this.options = options;

    this.provider = new AgentProvider(logger);
    const client = this.provider.getClient(
      options.modelName,
      options.clientOptions || {},
      options.userProvidedInstructions,
      tools,
    );
    this.agentClient = client;
    this.setupAgentClient();
    this.agent = client;
  }

  private setupAgentClient(): void {
    // Provide screenshots to the agent client
    this.agentClient.setScreenshotProvider(async () => {
      const page = await this.v3.context.awaitActivePage();
      const base64 = await page.screenshot({ fullPage: false });
      return base64.toString("base64"); // base64 png
    });

    // Provide action executor
    this.agentClient.setActionHandler(async (action) => {
      action.pageUrl = (await this.v3.context.awaitActivePage()).url();

      const defaultDelay = 500;
      const waitBetween =
        (this.options.clientOptions?.waitBetweenActions as number) ||
        defaultDelay;
      try {
        // Try to inject cursor before each action if enabled
        if (this.highlightCursor) {
          try {
            await this.injectCursor();
          } catch {
            // Ignore cursor injection failures
          }
        }
        await new Promise((r) => setTimeout(r, 300));
        await this.executeAction(action);

        action.timestamp = Date.now();

        await new Promise((r) => setTimeout(r, waitBetween));
        try {
          await this.captureAndSendScreenshot();
        } catch (e) {
          this.logger({
            category: "agent",
            message: `Warning: Failed to take screenshot after action: ${String(
              (e as Error)?.message ?? e,
            )}`,
            level: 1,
          });
        }
      } catch (error) {
        const msg = (error as Error)?.message ?? String(error);
        this.logger({
          category: "agent",
          message: `Error executing action ${action.type}: ${msg}`,
          level: 0,
        });
        throw error;
      }
    });

    void this.updateClientViewport();
    void this.updateClientUrl();
  }

  async execute(
    optionsOrInstruction: AgentExecuteOptions | string,
  ): Promise<AgentResult> {
    const options =
      typeof optionsOrInstruction === "string"
        ? { instruction: optionsOrInstruction }
        : optionsOrInstruction;

    this.highlightCursor = options.highlightCursor !== false;

    // Redirect if blank
    const page = await this.v3.context.awaitActivePage();
    const currentUrl = page.url();
    if (!currentUrl || currentUrl === "about:blank") {
      this.logger({
        category: "agent",
        message: `Page URL is empty. Navigating to https://www.google.com ...`,
        level: 1,
      });
      await page.goto("https://www.google.com", { waitUntil: "load" });
    }

    if (this.highlightCursor) {
      try {
        await this.injectCursor();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger({
          category: "agent",
          message: `Warning: Failed to inject cursor: ${errorMessage}. Continuing with execution.`,
          level: 1,
        });
        // Continue execution even if cursor injection fails
      }
    }

    const start = Date.now();
    const result = await this.agent.execute({ options, logger: this.logger });
    const inferenceTimeMs = Date.now() - start;
    if (result.usage) {
      this.v3.updateMetrics(
        V3FunctionName.AGENT,
        result.usage.input_tokens,
        result.usage.output_tokens,
        result.usage.reasoning_tokens ?? 0,
        result.usage.cached_input_tokens ?? 0,
        inferenceTimeMs,
      );
    }
    return result;
  }

  private async executeAction(
    action: AgentAction,
  ): Promise<ActionExecutionResult> {
    const page = await this.v3.context.awaitActivePage();
    const recording = this.v3.isAgentReplayActive();
    switch (action.type) {
      case "click": {
        const { x, y, button = "left", clickCount } = action;
        if (recording) {
          const xpath = await page.click(x as number, y as number, {
            button: (button as "left" | "right" | "middle") ?? "left",
            clickCount: (clickCount as number) ?? 1,
            returnXpath: true,
          });
          const normalized = this.ensureXPath(xpath);
          if (normalized) {
            const stagehandAction: Action = {
              selector: normalized,
              description: this.describePointerAction("click", x, y),
              method: "click",
              arguments: [],
            };
            this.recordCuaActStep(
              action,
              [stagehandAction],
              stagehandAction.description,
            );
          }
        } else {
          await page.click(x as number, y as number, {
            button: (button as "left" | "right" | "middle") ?? "left",
            clickCount: (clickCount as number) ?? 1,
          });
        }
        return { success: true };
      }
      case "double_click":
      case "doubleClick": {
        const { x, y } = action;
        if (recording) {
          const xpath = await page.click(x as number, y as number, {
            button: "left",
            clickCount: 2,
            returnXpath: true,
          });
          const normalized = this.ensureXPath(xpath);
          if (normalized) {
            const stagehandAction: Action = {
              selector: normalized,
              description: this.describePointerAction("double click", x, y),
              method: "doubleClick",
              arguments: [],
            };
            this.recordCuaActStep(
              action,
              [stagehandAction],
              stagehandAction.description,
            );
          }
        } else {
          await page.click(x as number, y as number, {
            button: "left",
            clickCount: 2,
          });
        }
        return { success: true };
      }
      case "tripleClick": {
        const { x, y } = action;
        if (recording) {
          const xpath = await page.click(x as number, y as number, {
            button: "left",
            clickCount: 3,
            returnXpath: true,
          });
          const normalized = this.ensureXPath(xpath);
          if (normalized) {
            const stagehandAction: Action = {
              selector: normalized,
              description: this.describePointerAction("triple click", x, y),
              method: "tripleClick",
              arguments: [],
            };
            this.recordCuaActStep(
              action,
              [stagehandAction],
              stagehandAction.description,
            );
          }
        } else {
          await page.click(x as number, y as number, {
            clickCount: 3,
          });
        }
        return { success: true };
      }
      case "type": {
        const { text } = action;
        await page.type(String(text ?? ""));
        if (recording) {
          const xpath = await computeActiveElementXpath(page);
          const normalized = this.ensureXPath(xpath);
          if (normalized) {
            const stagehandAction: Action = {
              selector: normalized,
              description: this.describeTypeAction(String(text ?? "")),
              method: "type",
              arguments: [String(text ?? "")],
            };
            this.recordCuaActStep(
              action,
              [stagehandAction],
              stagehandAction.description,
            );
          }
        }
        return { success: true };
      }
      case "keypress": {
        const { keys } = action;
        const keyList = Array.isArray(keys) ? keys : [keys];
        const stagehandActions: Action[] = [];
        for (const rawKey of keyList) {
          const mapped = mapKeyToPlaywright(String(rawKey ?? ""));
          await page.keyPress(mapped);
          if (recording) {
            stagehandActions.push({
              selector: "xpath=/html",
              description: `press ${mapped}`,
              method: "press",
              arguments: [mapped],
            });
          }
        }
        if (recording && stagehandActions.length > 0) {
          this.recordCuaActStep(
            action,
            stagehandActions,
            stagehandActions
              .map((a) => a.description)
              .filter(Boolean)
              .join(", ") || "keypress",
          );
        }
        return { success: true };
      }
      case "scroll": {
        const { x, y, scroll_x = 0, scroll_y = 0 } = action;
        await page.scroll(
          (x as number) ?? 0,
          (y as number) ?? 0,
          (scroll_x as number) ?? 0,
          (scroll_y as number) ?? 0,
        );
        this.v3.recordAgentReplayStep({
          type: "scroll",
          deltaX: Number(scroll_x ?? 0),
          deltaY: Number(scroll_y ?? 0),
          anchor:
            typeof x === "number" && typeof y === "number"
              ? { x: Math.round(x), y: Math.round(y) }
              : undefined,
        });
        return { success: true };
      }
      case "drag": {
        const { path } = action;
        if (Array.isArray(path) && path.length >= 2) {
          const start = path[0];
          const end = path[path.length - 1];
          if (recording) {
            const xps = await page.dragAndDrop(start.x, start.y, end.x, end.y, {
              steps: Math.min(20, Math.max(5, path.length)),
              delay: 10,
              returnXpath: true,
            });
            const [fromXpath, toXpath] = (xps as [string, string]) || ["", ""];
            const from = this.ensureXPath(fromXpath);
            const to = this.ensureXPath(toXpath);
            if (from && to) {
              const stagehandAction: Action = {
                selector: from,
                description: this.describeDragAction(),
                method: "dragAndDrop",
                arguments: [to],
              };
              this.recordCuaActStep(
                action,
                [stagehandAction],
                stagehandAction.description,
              );
            }
          } else {
            await page.dragAndDrop(start.x, start.y, end.x, end.y, {
              steps: Math.min(20, Math.max(5, path.length)),
              delay: 10,
            });
          }
        }
        return { success: true };
      }
      case "move": {
        // No direct cursor-only move; rely on overlay to show clicks/scrolls
        return { success: true };
      }
      case "wait": {
        const time = action?.timeMs ?? 1000;
        await new Promise((r) => setTimeout(r, time));
        if (time > 0 && recording) {
          this.v3.recordAgentReplayStep({ type: "wait", timeMs: Number(time) });
        }
        return { success: true };
      }
      case "screenshot": {
        // Already handled around actions
        return { success: true };
      }
      case "goto": {
        const { url } = action;
        await page.goto(String(url ?? ""), { waitUntil: "load" });
        if (recording) {
          this.v3.recordAgentReplayStep({
            type: "goto",
            url: String(url ?? ""),
          });
        }
        return { success: true };
      }
      case "back": {
        await page.goBack();
        if (recording) {
          this.v3.recordAgentReplayStep({
            type: "back",
          });
        }
        return { success: true };
      }
      case "forward": {
        await page.goForward();
        if (recording) {
          this.v3.recordAgentReplayStep({
            type: "forward",
          });
        }
        return { success: true };
      }
      case "open_web_browser": {
        // Browser is already open, this is a no-op
        return { success: true };
      }
      case "custom_tool": {
        // Custom tools are handled by the agent client directly
        return { success: true };
      }
      default:
        this.logger({
          category: "agent",
          message: `Unknown action type: ${String(action.type)}`,
          level: 1,
        });
        return {
          success: false,
          error: `Unknown action ${String(action.type)}`,
        };
    }
  }

  private ensureXPath(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.startsWith("xpath=") ? trimmed : `xpath=${trimmed}`;
  }

  private describePointerAction(kind: string, x: unknown, y: unknown): string {
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      return `${kind} at (${Math.round(nx)}, ${Math.round(ny)})`;
    }
    return kind;
  }

  private describeTypeAction(text: string): string {
    const snippet = text.length > 30 ? `${text.slice(0, 27)}...` : text;
    return `type "${snippet}"`;
  }

  private describeDragAction(): string {
    return "drag and drop";
  }

  private buildInstructionFallback(
    agentAction: AgentAction,
    fallback: string,
  ): string {
    const raw =
      (typeof agentAction.action === "string" && agentAction.action.trim()) ||
      (typeof agentAction.reasoning === "string" &&
        agentAction.reasoning.trim());
    return raw && raw.length > 0 ? raw : fallback;
  }

  private recordCuaActStep(
    agentAction: AgentAction,
    stagehandActions: Action[],
    fallback: string,
  ): void {
    if (!stagehandActions.length) return;
    const instruction = this.buildInstructionFallback(agentAction, fallback);
    const description = stagehandActions[0]?.description || instruction;
    const actions = stagehandActions.map((act) => ({
      ...act,
      description: act.description || description,
    }));
    this.v3.recordAgentReplayStep({
      type: "act",
      instruction,
      actions,
      actionDescription: description,
      message:
        typeof agentAction.reasoning === "string" &&
        agentAction.reasoning.trim().length > 0
          ? agentAction.reasoning.trim()
          : undefined,
    });
  }

  private async updateClientViewport(): Promise<void> {
    try {
      const page = await this.v3.context.awaitActivePage();
      const { w, h } = await page.mainFrame().evaluate<{
        w: number;
        h: number;
      }>("({ w: window.innerWidth, h: window.innerHeight })");
      if (w && h) this.agentClient.setViewport(w, h);
    } catch {
      //
    }
  }

  private async updateClientUrl(): Promise<void> {
    try {
      const page = await this.v3.context.awaitActivePage();
      const url = page.url();
      this.agentClient.setCurrentUrl(url);
    } catch {
      //
    }
  }

  async captureAndSendScreenshot(): Promise<unknown> {
    this.logger({
      category: "agent",
      message: "Capturing screenshot",
      level: 1,
    });
    try {
      const page = await this.v3.context.awaitActivePage();
      const base64Image = await page.screenshot({ fullPage: false });
      if (this.screenshotCollector) {
        this.screenshotCollector.addScreenshot(base64Image);
      }
      const currentUrl = page.url();
      return await this.agentClient.captureScreenshot({
        base64Image,
        currentUrl,
      });
    } catch (e) {
      this.logger({
        category: "agent",
        message: `Error capturing screenshot: ${String((e as Error)?.message ?? e)}`,
        level: 0,
      });
      return null;
    }
  }

  private async injectCursor(): Promise<void> {
    try {
      const page = await this.v3.context.awaitActivePage();
      await page.enableCursorOverlay();
    } catch {
      // Best-effort only
    }
  }

  /**
   * Set the screenshot collector for this agent handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setScreenshotCollector(collector: any): void {
    this.screenshotCollector = collector;
  }

  /**
   * Get the screenshot collector
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getScreenshotCollector(): any {
    return this.screenshotCollector;
  }
}

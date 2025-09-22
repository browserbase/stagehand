import {
  ActionExecutionResult,
  AgentAction,
  AgentExecuteOptions,
  AgentHandlerOptions,
  AgentResult,
  KeyPressActionStashEntry,
  TypeActionStashEntry,
} from "../types/agent";
import { LogLine } from "../types/log";
import { V3 } from "@/lib/v3/v3";
import { AgentClient } from "../agent/AgentClient";
import { AgentProvider } from "../agent/AgentProvider";
import { mapKeyToPlaywright } from "../agent/utils/cuaKeyMapping";
import { V3FunctionName } from "@/lib/v3/types";
import { ToolSet } from "ai";
import { computeActiveElementXpath } from "@/lib/v3/understudy/a11y/snapshot";

export class V3CuaAgentHandler {
  private v3: V3;
  private agent: AgentClient;
  private provider: AgentProvider;
  private logger: (message: LogLine) => void;
  private agentClient: AgentClient;
  private options: AgentHandlerOptions;

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
      return base64; // base64 png
    });

    // Provide action executor
    this.agentClient.setActionHandler(async (action) => {
      const defaultDelay = 1000;
      const waitBetween =
        (this.options.clientOptions?.waitBetweenActions as number) ||
        defaultDelay;
      try {
        try {
          await this.injectCursor();
        } catch {
          //
        }
        await new Promise((r) => setTimeout(r, 300));
        await this.executeAction(action);
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

    // Redirect if blank
    const page = await this.v3.context.awaitActivePage();
    const currentUrl = await page.url();
    if (!currentUrl || currentUrl === "about:blank") {
      this.logger({
        category: "agent",
        message: `Page URL is empty. Navigating to https://www.google.com ...`,
        level: 1,
      });
      await page.goto("https://www.google.com", { waitUntil: "load" });
    }

    try {
      await this.injectCursor();
    } catch (e) {
      this.logger({
        category: "agent",
        message: `Warning: Failed to enable cursor overlay: ${String(
          (e as Error)?.message ?? e,
        )}`,
        level: 1,
      });
    }

    if (options.autoScreenshot !== false) {
      try {
        await this.captureAndSendScreenshot();
      } catch (e) {
        this.logger({
          category: "agent",
          message: `Warning: initial screenshot failed: ${String(
            (e as Error)?.message ?? e,
          )}`,
          level: 1,
        });
      }
    }

    const start = Date.now();
    // Reset global stash for this run
    this.v3.clearActionStash();
    const result = await this.agent.execute({ options, logger: this.logger });
    const inferenceTimeMs = Date.now() - start;
    if (result.usage) {
      this.v3.updateMetrics(
        V3FunctionName.AGENT,
        result.usage.input_tokens,
        result.usage.output_tokens,
        inferenceTimeMs,
      );
    }
    return result;
  }

  private async executeAction(
    action: AgentAction,
  ): Promise<ActionExecutionResult> {
    const page = await this.v3.context.awaitActivePage();
    const wantXpath = Boolean(
      this.options.stashActions ||
        this.options.clientOptions?.stashActions ||
        this.options.clientOptions?.returnXpathForActions,
    );
    switch (action.type) {
      case "click": {
        const { x, y, button = "left", clickCount } = action;
        const xpath = await page.click(x as number, y as number, {
          button: (button as "left" | "right" | "middle") ?? "left",
          clickCount: (clickCount as number) ?? 1,
          returnXpath: wantXpath,
        });
        if (wantXpath)
          this.v3.recordActionStash({
            type: "click",
            xpath: String(xpath ?? ""),
            ts: Date.now(),
          });
        return { success: true };
      }
      case "double_click":
      case "doubleClick": {
        const { x, y } = action;
        const xpath = await page.click(x as number, y as number, {
          button: "left",
          clickCount: 2,
          returnXpath: wantXpath,
        });
        if (wantXpath)
          this.v3.recordActionStash({
            type: "doubleClick",
            xpath: String(xpath ?? ""),
            ts: Date.now(),
          });
        return { success: true };
      }
      case "type": {
        const { text } = action;
        await page.type(String(text ?? ""));
        if (wantXpath) {
          const xpath = await computeActiveElementXpath(page);
          this.v3.recordActionStash({
            type: "type",
            text: String(text ?? ""),
            xpath: String(xpath ?? ""),
            ts: Date.now(),
          } as TypeActionStashEntry);
        }
        return { success: true };
      }
      case "keypress": {
        const { keys } = action;
        if (Array.isArray(keys)) {
          for (const k of keys) {
            const mapped = mapKeyToPlaywright(String(k));
            await page.keyPress(mapped);
          }
        }
        if (wantXpath) {
          const mappedJoined = Array.isArray(keys)
            ? keys.map((k) => mapKeyToPlaywright(String(k))).join(",")
            : mapKeyToPlaywright(String(keys ?? ""));
          this.v3.recordActionStash({
            type: "keyPress",
            keys: mappedJoined,
            ts: Date.now(),
          } as KeyPressActionStashEntry);
        }
        return { success: true };
      }
      case "scroll": {
        const { x, y, scroll_x = 0, scroll_y = 0 } = action;
        const xpath = await page.scroll(
          (x as number) ?? 0,
          (y as number) ?? 0,
          (scroll_x as number) ?? 0,
          (scroll_y as number) ?? 0,
          { returnXpath: wantXpath },
        );
        if (wantXpath)
          this.v3.recordActionStash({
            type: "scroll",
            xpath: String(xpath ?? ""),
            dx: (scroll_x as number) ?? 0,
            dy: (scroll_y as number) ?? 0,
            ts: Date.now(),
          });
        return { success: true };
      }
      case "drag": {
        const { path } = action;
        if (Array.isArray(path) && path.length >= 2) {
          const start = path[0];
          const end = path[path.length - 1];
          const xps = await page.dragAndDrop(start.x, start.y, end.x, end.y, {
            steps: Math.min(20, Math.max(5, path.length)),
            delay: 10,
            returnXpath: wantXpath,
          });
          if (wantXpath) {
            const [fromXpath, toXpath] = (xps as [string, string]) || ["", ""];
            this.v3.recordActionStash({
              type: "dragAndDrop",
              fromXpath,
              toXpath,
              ts: Date.now(),
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
        return { success: true };
      }
      case "screenshot": {
        // Already handled around actions
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
      const url = await page.url();
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
      const currentUrl = await page.url();
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
}

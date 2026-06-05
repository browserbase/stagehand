import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogLine } from "../../lib/v3/types/public/logs.js";
import { CaptchaSolver } from "../../lib/v3/agent/utils/captchaSolver.js";
import { V3AgentHandler } from "../../lib/v3/handlers/v3AgentHandler.js";

const SOLVING_STARTED = "browserbase-solving-started";
const SOLVING_FINISHED = "browserbase-solving-finished";
const SOLVING_ERRORED = "browserbase-solving-errored";

type ConsoleListener = (message: { text: () => string }) => void;

class MockPage {
  private listeners = new Set<ConsoleListener>();
  public currentUrl = "https://example.com";
  public clickCalls: Array<{
    x: number;
    y: number;
    options?: Record<string, unknown>;
  }> = [];
  public keyPressCalls: Array<{ key: string; options?: { delay?: number } }> =
    [];
  public reloadCalls: Array<{ waitUntil?: string }> = [];
  public scrollCalls: Array<{
    x: number;
    y: number;
    scrollX: number;
    scrollY: number;
    options?: Record<string, unknown>;
  }> = [];
  public captchaBoxes: Array<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }> = [];

  on(event: string, listener: ConsoleListener): void {
    if (event === "console") {
      this.listeners.add(listener);
    }
  }

  off(event: string, listener: ConsoleListener): void {
    if (event === "console") {
      this.listeners.delete(listener);
    }
  }

  emitConsole(text: string): void {
    const message = { text: () => text };
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  url(): string {
    return this.currentUrl;
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from("fake-image");
  }

  async evaluate<T>(): Promise<T> {
    return this.captchaBoxes as T;
  }

  mainFrame(): { evaluate: () => Promise<{ w: number; h: number }> } {
    return {
      evaluate: async () => ({ w: 1288, h: 711 }),
    };
  }

  async click(
    x: number,
    y: number,
    options?: Record<string, unknown>,
  ): Promise<string> {
    this.clickCalls.push({ x, y, options });
    return "xpath=/html/body/button";
  }

  async keyPress(key: string, options?: { delay?: number }): Promise<void> {
    this.keyPressCalls.push({ key, options });
  }

  async reload(options?: { waitUntil?: string }): Promise<void> {
    this.reloadCalls.push(options ?? {});
  }

  async scroll(
    x: number,
    y: number,
    scrollX: number,
    scrollY: number,
    options?: Record<string, unknown>,
  ): Promise<void> {
    this.scrollCalls.push({ x, y, scrollX, scrollY, options });
  }
}

class FakeCuaClient {
  public contextNotes: string[] = [];
  public preStepHook?: () => Promise<void>;
  public actionHandler?: (action: Record<string, unknown>) => Promise<void>;
  public screenshotProvider?: () => Promise<{
    base64: string;
    mediaType: "image/png" | "image/jpeg";
  }>;
  public executeImpl = vi.fn(async (options: unknown) => {
    void options;
    return {
      success: true,
      message: "ok",
      actions: [],
      completed: true,
    };
  });
  public captureScreenshot = vi.fn(async () => null);
  public setViewport = vi.fn();
  public setCurrentUrl = vi.fn();
  public setScreenshotProvider = vi.fn(
    (
      provider: () => Promise<{
        base64: string;
        mediaType: "image/png" | "image/jpeg";
      }>,
    ) => {
      this.screenshotProvider = provider;
    },
  );
  public setSafetyConfirmationHandler = vi.fn();

  setActionHandler(
    handler: (action: Record<string, unknown>) => Promise<void>,
  ): void {
    this.actionHandler = handler;
  }

  setPreStepHook(handler: () => Promise<void>): void {
    this.preStepHook = handler;
  }

  addContextNote(note: string): void {
    this.contextNotes.push(note);
  }

  async execute(options: unknown): Promise<{
    success: boolean;
    message: string;
    actions: unknown[];
    completed: boolean;
  }> {
    return this.executeImpl(options);
  }
}

let fakeCuaClient: FakeCuaClient;

vi.mock("../../lib/v3/agent/AgentProvider", () => ({
  AgentProvider: class {
    constructor(logger: unknown) {
      void logger;
    }

    getClient(): FakeCuaClient {
      return fakeCuaClient;
    }
  },
}));

import { V3CuaAgentHandler } from "../../lib/v3/handlers/v3CuaAgentHandler.js";

function collectUserMessages(
  messages: Array<{ role: string; content: unknown }>,
): Array<{ role: "user"; content: string }> {
  return messages.filter(
    (message): message is { role: "user"; content: string } =>
      message.role === "user" && typeof message.content === "string",
  );
}

describe("agent captcha hooks", () => {
  let page: MockPage;
  let logs: LogLine[];
  let logger: (line: LogLine) => void;

  beforeEach(() => {
    page = new MockPage();
    logs = [];
    logger = (line) => {
      logs.push(line);
    };
    fakeCuaClient = new FakeCuaClient();
  });

  it("blocks regular agent prepareStep until the solver finishes and injects one solved message", async () => {
    const handler = new V3AgentHandler(
      {
        isCaptchaAutoSolveEnabled: true,
      } as never,
      logger,
      {} as never,
    );
    const solver = new CaptchaSolver();
    solver.init(async () => page as never);

    const userCallback = vi.fn(async (options) => options);
    const prepareStep = (
      handler as unknown as {
        createPrepareStep: (
          callback?: (options: Record<string, unknown>) => Promise<unknown>,
          captchaSolver?: CaptchaSolver,
        ) => (options: Record<string, unknown>) => Promise<unknown>;
      }
    ).createPrepareStep(userCallback, solver);

    const options = {
      messages: [{ role: "user", content: "start" }],
    };

    await prepareStep(options);
    page.emitConsole(SOLVING_STARTED);

    const secondCall = prepareStep(options);
    await Promise.resolve();
    expect(userCallback).toHaveBeenCalledTimes(1);

    page.emitConsole(SOLVING_FINISHED);
    await secondCall;

    expect(userCallback).toHaveBeenCalledTimes(2);
    expect(
      collectUserMessages(
        options.messages as Array<{ role: string; content: unknown }>,
      ).filter((message) =>
        message.content.includes("automatically detected and solved"),
      ),
    ).toHaveLength(1);
  });

  it("injects one error message when the regular agent solver errors", async () => {
    const handler = new V3AgentHandler(
      {
        isCaptchaAutoSolveEnabled: true,
      } as never,
      logger,
      {} as never,
    );
    const solver = new CaptchaSolver();
    solver.init(async () => page as never);

    const prepareStep = (
      handler as unknown as {
        createPrepareStep: (
          callback?: (options: Record<string, unknown>) => Promise<unknown>,
          captchaSolver?: CaptchaSolver,
        ) => (options: Record<string, unknown>) => Promise<unknown>;
      }
    ).createPrepareStep(undefined, solver);

    const options = {
      messages: [{ role: "user", content: "start" }],
    };

    await prepareStep(options);
    page.emitConsole(SOLVING_STARTED);

    const pending = prepareStep(options);
    page.emitConsole(SOLVING_ERRORED);
    await pending;

    expect(
      collectUserMessages(
        options.messages as Array<{ role: string; content: unknown }>,
      ).filter((message) =>
        message.content.includes("automatic captcha solver failed"),
      ),
    ).toHaveLength(1);
  });

  it("pauses the CUA loop at prepareStep while Browserbase solves a captcha", async () => {
    let secondPrepareStarted = false;

    fakeCuaClient.executeImpl = vi.fn(async () => {
      await fakeCuaClient.preStepHook?.();
      page.emitConsole(SOLVING_STARTED);

      const blockedPrepare = fakeCuaClient.preStepHook?.() ?? Promise.resolve();
      secondPrepareStarted = true;
      await blockedPrepare;

      return {
        success: true,
        message: "ok",
        actions: [],
        completed: true,
      };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: true,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "anthropic/claude-haiku-4-5-20251001",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );

    const execution = handler.execute({
      instruction: "Describe the page briefly.",
      highlightCursor: false,
    });

    await vi.waitFor(() => {
      expect(secondPrepareStarted).toBe(true);
      expect(
        logs.some((line) =>
          line.message.includes("waiting for Browserbase to solve"),
        ),
      ).toBe(true);
    });

    expect(logs.some((line) => line.message.includes("Captcha solved"))).toBe(
      false,
    );

    page.emitConsole(SOLVING_FINISHED);
    await execution;

    expect(fakeCuaClient.contextNotes).toEqual([
      expect.stringContaining("automatically detected and solved"),
    ]);
    expect(logs.some((line) => line.message.includes("Captcha solved"))).toBe(
      true,
    );
  });

  it("pauses CUA actions until the captcha solver finishes", async () => {
    let actionStarted = false;

    fakeCuaClient.executeImpl = vi.fn(async () => {
      await fakeCuaClient.preStepHook?.();
      page.emitConsole(SOLVING_STARTED);

      const pendingAction =
        fakeCuaClient.actionHandler?.({ type: "screenshot" }) ??
        Promise.resolve();
      actionStarted = true;
      await pendingAction;

      return {
        success: true,
        message: "ok",
        actions: [],
        completed: true,
      };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: true,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "anthropic/claude-haiku-4-5-20251001",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );
    const executeActionSpy = vi
      .spyOn(
        handler as unknown as {
          executeAction: (action: Record<string, unknown>) => Promise<unknown>;
        },
        "executeAction",
      )
      .mockResolvedValue({ success: true });
    vi.spyOn(handler, "captureAndSendScreenshot").mockResolvedValue(null);

    const execution = handler.execute({
      instruction: "Describe the page briefly.",
      highlightCursor: false,
    });

    await vi.waitFor(() => {
      expect(actionStarted).toBe(true);
    });

    expect(executeActionSpy).not.toHaveBeenCalled();
    page.emitConsole(SOLVING_FINISHED);
    await execution;

    expect(executeActionSpy).toHaveBeenCalledTimes(1);
    expect(fakeCuaClient.contextNotes).toEqual([
      expect.stringContaining("automatically detected and solved"),
    ]);
    expect(logs.some((line) => line.message.includes("Captcha solved"))).toBe(
      true,
    );
  });

  it("skips post-solve clicks on the captcha widget and injects another note", async () => {
    page.captchaBoxes = [{ left: 0, top: 400, right: 140, bottom: 470 }];

    fakeCuaClient.executeImpl = vi.fn(async () => {
      await fakeCuaClient.preStepHook?.();
      page.emitConsole(SOLVING_STARTED);

      const blockedPrepare = fakeCuaClient.preStepHook?.() ?? Promise.resolve();
      page.emitConsole(SOLVING_FINISHED);
      await blockedPrepare;

      await fakeCuaClient.actionHandler?.({
        type: "click",
        button: "left",
        x: 63,
        y: 436,
      });

      return {
        success: true,
        message: "ok",
        actions: [],
        completed: true,
      };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: true,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "anthropic/claude-haiku-4-5-20251001",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );
    const executeActionSpy = vi
      .spyOn(
        handler as unknown as {
          executeAction: (action: Record<string, unknown>) => Promise<unknown>;
        },
        "executeAction",
      )
      .mockResolvedValue({ success: true });
    vi.spyOn(handler, "captureAndSendScreenshot").mockResolvedValue(null);

    await handler.execute({
      instruction: "Describe the page briefly.",
      highlightCursor: false,
    });

    expect(executeActionSpy).not.toHaveBeenCalled();
    expect(fakeCuaClient.contextNotes).toEqual([
      expect.stringContaining("automatically detected and solved"),
      expect.stringContaining("Original task: Describe the page briefly."),
    ]);
    expect(
      logs.some((line) =>
        line.message.includes("Skipped click on solved captcha widget"),
      ),
    ).toBe(true);
  });
});

describe("v3 cua handler screenshot behavior", () => {
  let page: MockPage;
  let logs: LogLine[];
  let logger: (line: LogLine) => void;

  beforeEach(() => {
    page = new MockPage();
    logs = [];
    logger = (line) => {
      logs.push(line);
    };
    fakeCuaClient = new FakeCuaClient();
  });

  it("does not take per-action screenshots when a batch of actions runs", async () => {
    const screenshotSpy = vi.spyOn(page, "screenshot");
    const batchSize = 4;

    fakeCuaClient.executeImpl = vi.fn(async () => {
      for (let i = 0; i < batchSize; i += 1) {
        await fakeCuaClient.actionHandler?.({
          type: "scroll",
          x: 0,
          y: 0,
          scroll_x: 0,
          scroll_y: 100,
        });
      }
      return {
        success: true,
        message: "ok",
        actions: [],
        completed: true,
      };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: false,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "openai/gpt-5.4",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );

    vi.spyOn(
      handler as unknown as {
        executeAction: (action: Record<string, unknown>) => Promise<unknown>;
      },
      "executeAction",
    ).mockResolvedValue({ success: true });

    await handler.execute({
      instruction: "scroll to the bottom",
      highlightCursor: false,
    });

    // The handler must not call page.screenshot for each action in a batch —
    // the CUA client takes a single screenshot after all actions itself.
    expect(screenshotSpy).not.toHaveBeenCalled();
  });

  it("still returns provider screenshots when screenshot evidence callbacks fail", async () => {
    const screenshotBase64 = Buffer.from("fake-image").toString("base64");
    const onEvidence = vi.fn(async (event: { type: string }) => {
      if (event.type === "screenshot") {
        throw new Error("recorder failed");
      }
    });

    fakeCuaClient.executeImpl = vi.fn(async () => {
      await expect(fakeCuaClient.screenshotProvider?.()).resolves.toEqual({
        base64: screenshotBase64,
        mediaType: "image/png",
      });
      return {
        success: true,
        message: "ok",
        actions: [],
        completed: true,
      };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: false,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "openai/gpt-5.4",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );

    await handler.execute({
      instruction: "describe the page",
      highlightCursor: false,
      callbacks: { onEvidence },
    });

    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ type: "screenshot" }),
    );
    expect(
      logs.some((line) =>
        line.message.includes("onEvidence callback failed for screenshot"),
      ),
    ).toBe(true);
  });

  it("keeps CUA client current URL fresh after screenshots and actions", async () => {
    fakeCuaClient.executeImpl = vi.fn(async () => {
      await fakeCuaClient.screenshotProvider?.();
      page.currentUrl = "https://example.com/after-action";
      await fakeCuaClient.actionHandler?.({ type: "wait", timeMs: 0 });
      return {
        success: true,
        message: "ok",
        actions: [],
        completed: true,
      };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: false,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "openai/gpt-5.4",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );
    vi.spyOn(
      handler as unknown as {
        executeAction: (action: Record<string, unknown>) => Promise<unknown>;
      },
      "executeAction",
    ).mockResolvedValue({ success: true });

    await handler.execute({
      instruction: "wait",
      highlightCursor: false,
    });

    expect(fakeCuaClient.setCurrentUrl).toHaveBeenCalledWith(
      "https://example.com",
    );
    expect(fakeCuaClient.setCurrentUrl).toHaveBeenLastCalledWith(
      "https://example.com/after-action",
    );
  });

  it("refreshes the CUA client URL even when the action throws", async () => {
    fakeCuaClient.executeImpl = vi.fn(async () => {
      await fakeCuaClient.screenshotProvider?.();
      // The action navigates the page and then throws (e.g. a click that
      // triggers a load which times out). The Yutori client catches the
      // action-handler error and continues the loop.
      page.currentUrl = "https://example.com/after-error-nav";
      await fakeCuaClient
        .actionHandler?.({ type: "click", x: 1, y: 2, button: "left" })
        .catch(() => {});
      return { success: true, message: "ok", actions: [], completed: true };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: false,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "openai/gpt-5.4",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );
    vi.spyOn(
      handler as unknown as {
        executeAction: (action: Record<string, unknown>) => Promise<unknown>;
      },
      "executeAction",
    ).mockRejectedValue(new Error("navigation timeout"));

    await handler.execute({
      instruction: "click",
      highlightCursor: false,
    });

    // Even though the action threw, the post-action URL is pushed to the client
    // so the tool-result "Current URL" suffix is not stale.
    expect(fakeCuaClient.setCurrentUrl).toHaveBeenLastCalledWith(
      "https://example.com/after-error-nav",
    );
  });

  it("executes modifiers, hold-key delays, and refresh actions", async () => {
    const recordAgentReplayStep = vi.fn();
    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: false,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        recordAgentReplayStep,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "openai/gpt-5.4",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );

    const executeAction = (
      handler as unknown as {
        executeAction: (action: Record<string, unknown>) => Promise<unknown>;
      }
    ).executeAction.bind(handler);

    await executeAction({
      type: "click",
      x: 10,
      y: 20,
      button: "left",
      modifier: "ctrl",
    });
    await executeAction({
      type: "scroll",
      x: 1,
      y: 2,
      scroll_x: 0,
      scroll_y: 300,
      modifier: "shift",
    });
    await executeAction({
      type: "keypress",
      keys: ["Shift"],
      holdMs: 250,
    });
    await executeAction({ type: "refresh" });

    // Modifiers are passed to page.click / page.scroll (which set the CDP
    // mouse-event modifiers bitmask) rather than held via keyDown/keyUp.
    expect(page.clickCalls).toEqual([
      expect.objectContaining({
        x: 10,
        y: 20,
        options: expect.objectContaining({ modifiers: ["Control"] }),
      }),
    ]);
    expect(page.scrollCalls).toEqual([
      {
        x: 1,
        y: 2,
        scrollX: 0,
        scrollY: 300,
        options: { modifiers: ["Shift"] },
      },
    ]);
    expect(page.keyPressCalls).toEqual([
      { key: "Shift", options: { delay: 250 } },
    ]);
    expect(page.reloadCalls).toEqual([{ waitUntil: "load" }]);
  });

  it("passes modifiers to page.click on the recording path and still records a replay step", async () => {
    const recordAgentReplayStep = vi.fn();
    const handler = new V3CuaAgentHandler(
      {
        context: { awaitActivePage: async () => page },
        isCaptchaAutoSolveEnabled: false,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => true,
        recordAgentReplayStep,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "openai/gpt-5.4",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );

    const executeAction = (
      handler as unknown as {
        executeAction: (action: Record<string, unknown>) => Promise<unknown>;
      }
    ).executeAction.bind(handler);

    await executeAction({
      type: "click",
      x: 10,
      y: 20,
      button: "left",
      modifier: "ctrl",
    });

    // The modifier is passed to page.click on the recording path too ...
    expect(page.clickCalls).toEqual([
      expect.objectContaining({
        x: 10,
        y: 20,
        options: expect.objectContaining({ modifiers: ["Control"] }),
      }),
    ]);
    // ... and the action is still recorded for replay.
    expect(recordAgentReplayStep).toHaveBeenCalledWith(
      expect.objectContaining({ type: "act" }),
    );
  });

  it("records a failed action as step_finished {ok:false} and rethrows the original error", async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const onEvidence = vi.fn(async (event: { type: string }) => {
      events.push(event as { type: string });
    });

    fakeCuaClient.executeImpl = vi.fn(async () => {
      await fakeCuaClient.actionHandler?.({
        type: "click",
        button: "left",
        x: 5,
        y: 9,
      });
      return { success: true, message: "ok", actions: [], completed: true };
    });

    const handler = new V3CuaAgentHandler(
      {
        context: {
          awaitActivePage: async () => page,
        },
        isCaptchaAutoSolveEnabled: false,
        isAdvancedStealth: false,
        configuredViewport: { width: 1288, height: 711 },
        isAgentReplayActive: () => false,
        updateMetrics: vi.fn(),
      } as never,
      logger,
      {
        modelName: "openai/gpt-5.4",
        clientOptions: { waitBetweenActions: 1 },
      } as never,
    );
    vi.spyOn(
      handler as unknown as {
        executeAction: (action: Record<string, unknown>) => Promise<unknown>;
      },
      "executeAction",
    ).mockRejectedValue(new Error("click failed"));

    await expect(
      handler.execute({
        instruction: "click the thing",
        highlightCursor: false,
        callbacks: { onEvidence },
      }),
    ).rejects.toThrow("click failed");

    const stepFinished = events.find((e) => e.type === "step_finished");
    expect(stepFinished).toMatchObject({
      actionName: "click",
      toolOutput: { ok: false, error: "click failed" },
    });
  });
});

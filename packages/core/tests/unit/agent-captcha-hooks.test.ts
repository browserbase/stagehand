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
    return "https://example.com";
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
}

class FakeCuaClient {
  public contextNotes: string[] = [];
  public preStepHook?: () => Promise<void>;
  public actionHandler?: (action: Record<string, unknown>) => Promise<void>;
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
  public setScreenshotProvider = vi.fn();
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
        bus: { emit: vi.fn() },
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
        bus: { emit: vi.fn() },
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
        bus: { emit: vi.fn() },
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

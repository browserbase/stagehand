import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { BrowserContext } from "../understudy/context.js";
import { Page } from "../understudy/page.js";

class FakeCDPSession implements CDPSessionLike {
  readonly calls: Array<{ method: string; params?: object }> = [];
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();

  constructor(
    readonly responses: Record<string, (session: FakeCDPSession, params?: object) => unknown> = {},
    readonly id: string = "main",
  ) {}

  async send<Result = unknown>(method: string, params?: object): Promise<Result> {
    this.calls.push({ method, params });
    return (await this.responses[method]?.(this, params)) as Result;
  }

  on<Params = unknown>(event: string, handler: (params: Params) => void): void {
    const handlers = this.handlers.get(event) ?? new Set<(params: unknown) => void>();
    handlers.add(handler as (params: unknown) => void);
    this.handlers.set(event, handlers);
  }

  off<Params = unknown>(event: string, handler: (params: Params) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }

  async close(): Promise<void> {}

  emit<Params>(event: string, params: Params): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }

  callsFor(method: string): Array<{ method: string; params?: object }> {
    return this.calls.filter((call) => call.method === method);
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

function createPage(session: FakeCDPSession): Page {
  const connection = {
    send: async () => ({ success: true }),
    getTargets: async () => [],
  } as unknown as CdpConnection;
  return new Page(connection, session, "target-1", "frame-1", {} as StagehandLogger);
}

function addSameProcessChild(page: Page, session: FakeCDPSession): void {
  page.onFrameAttached("frame-2", "frame-1", session);
}

function adoptChildSession(page: Page, session: FakeCDPSession): void {
  page.adoptOopifSession(session, "frame-2");
}

function createContextPage(session: FakeCDPSession): { context: BrowserContext; page: Page } {
  const connection = {
    connected: true,
    send: async () => ({ success: true }),
    getTargets: async () => [],
    getSession: (sessionId: string) => (sessionId === session.id ? session : undefined),
  } as unknown as CdpConnection;
  const logger = {} as StagehandLogger;
  const context = new BrowserContext(connection, logger, {} as ChromeTabTargetController);
  const page = new Page(connection, session, "target-1", "frame-1", logger);
  context.pagesByTarget.set("target-1", page);
  return { context, page };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Page WebMCP invocation lifecycle", () => {
  it("invokes an explicit tool identity and registers one response listener", async () => {
    let invocation = 0;
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: `invocation-${++invocation}` }),
    });
    const page = createPage(session);
    addSameProcessChild(page, session);

    await expect(
      page.invokeWebMCPTool("frame-2", "search", {
        input: { searchQuery: "Stagehand" },
      }),
    ).resolves.toStrictEqual({
      invocationId: "invocation-1",
      toolName: "search",
      frameId: "frame-2",
      input: { searchQuery: "Stagehand" },
    });
    await expect(page.invokeWebMCPTool("frame-2", "reset")).resolves.toStrictEqual({
      invocationId: "invocation-2",
      toolName: "reset",
      frameId: "frame-2",
      input: {},
    });

    expect(session.callsFor("WebMCP.invokeTool")).toStrictEqual([
      {
        method: "WebMCP.invokeTool",
        params: {
          frameId: "frame-2",
          toolName: "search",
          input: { searchQuery: "Stagehand" },
        },
      },
      {
        method: "WebMCP.invokeTool",
        params: {
          frameId: "frame-2",
          toolName: "reset",
          input: {},
        },
      },
    ]);
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(1);
    await page.listWebMCPTools({ timeout: 0 });
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
  });

  it("routes an OOPIF invocation, response, and cancellation through its child session", async () => {
    const session = new FakeCDPSession();
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": () => ({ invocationId: "child-invocation" }),
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);

    await expect(
      page.invokeWebMCPTool("frame-2", "search", {
        input: { searchQuery: "Stagehand" },
      }),
    ).resolves.toStrictEqual({
      invocationId: "child-invocation",
      toolName: "search",
      frameId: "frame-2",
      input: { searchQuery: "Stagehand" },
    });
    expect(session.callsFor("WebMCP.invokeTool")).toHaveLength(0);
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
    expect(childSession.callsFor("WebMCP.invokeTool")).toStrictEqual([
      {
        method: "WebMCP.invokeTool",
        params: {
          frameId: "frame-2",
          toolName: "search",
          input: { searchQuery: "Stagehand" },
        },
      },
    ]);
    expect(childSession.listenerCount("WebMCP.toolResponded")).toBe(1);

    const result = page.waitForWebMCPInvocationResult("child-invocation");
    childSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "child-invocation",
      status: "Completed",
      output: { source: "child" },
    });
    await expect(result).resolves.toStrictEqual({
      invocationId: "child-invocation",
      status: "Completed",
      output: { source: "child" },
    });

    await page.cancelWebMCPInvocation("child-invocation");
    expect(session.callsFor("WebMCP.cancelInvocation")).toHaveLength(0);
    expect(childSession.callsFor("WebMCP.cancelInvocation")).toStrictEqual([
      {
        method: "WebMCP.cancelInvocation",
        params: { invocationId: "child-invocation" },
      },
    ]);
  });

  it("ignores a matching invocation response emitted by the wrong session", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "main-invocation" }),
    });
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": () => ({ invocationId: "child-invocation" }),
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);
    await page.invokeWebMCPTool("frame-1", "main");
    await page.invokeWebMCPTool("frame-2", "child");

    const result = page.waitForWebMCPInvocationResult("child-invocation");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "child-invocation",
      status: "Completed",
      output: { source: "wrong" },
    });
    childSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "child-invocation",
      status: "Completed",
      output: { source: "child" },
    });

    await expect(result).resolves.toStrictEqual({
      invocationId: "child-invocation",
      status: "Completed",
      output: { source: "child" },
    });
  });

  it.each([
    {
      status: "Completed" as const,
      event: { output: { resultValue: "found" } },
    },
    {
      status: "Canceled" as const,
      event: {},
    },
    {
      status: "Error" as const,
      event: {
        errorText: "Tool failed",
        exception: {
          type: "object" as const,
          description: "Error: Tool failed",
          value: { originalKey: "unchanged" },
        },
      },
    },
  ])("preserves a $status terminal response", async ({ status, event }) => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "search");

    const resultPromise = page.waitForWebMCPInvocationResult("invocation-1");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status,
      ...event,
    });

    await expect(resultPromise).resolves.toStrictEqual({
      invocationId: "invocation-1",
      status,
      ...event,
    });
  });

  it("returns the same terminal result before or after callers start waiting", async () => {
    let invocation = 0;
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: `invocation-${++invocation}` }),
    });
    const page = createPage(session);

    await page.invokeWebMCPTool("frame-1", "first");
    const waiting = page.waitForWebMCPInvocationResult("invocation-1");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
      output: { value: 1 },
    });
    const firstResult = await waiting;
    await expect(page.waitForWebMCPInvocationResult("invocation-1")).resolves.toBe(firstResult);

    await page.invokeWebMCPTool("frame-1", "second");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-2",
      status: "Completed",
      output: { value: 2 },
    });
    await expect(page.waitForWebMCPInvocationResult("invocation-2")).resolves.toStrictEqual({
      invocationId: "invocation-2",
      status: "Completed",
      output: { value: 2 },
    });
  });

  it.each([
    { status: "Completed" as const, output: { value: "early" } },
    { status: "Canceled" as const },
    {
      status: "Error" as const,
      errorText: "Tool failed",
      exception: { type: "object" as const, description: "Error: Tool failed" },
    },
  ])("retains the first early $status response", async (response) => {
    const event = { invocationId: "invocation-1", ...response };
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": (currentSession) => {
        currentSession.emit("WebMCP.toolResponded", event);
        currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
          invocationId: "invocation-1",
          status: "Completed",
          output: "duplicate before registration",
        });
        return { invocationId: "invocation-1" };
      },
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "search");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
      output: "duplicate after registration",
    });

    await expect(
      page.waitForWebMCPInvocationResult("invocation-1", { timeout: 10 }),
    ).resolves.toStrictEqual(event);
  });

  it("matches early responses to concurrent invocations regardless of resolve order", async () => {
    const resolvers = new Map<string, () => void>();
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": (currentSession, params) => {
        const { toolName } = params as Protocol.WebMCP.InvokeToolRequest;
        const invocationId = `${toolName}-invocation`;
        currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
          invocationId,
          status: "Completed",
          output: toolName,
        });
        return new Promise<Protocol.WebMCP.InvokeToolResponse>((resolve) => {
          resolvers.set(toolName, () => resolve({ invocationId }));
        });
      },
    });
    const page = createPage(session);
    const first = page.invokeWebMCPTool("frame-1", "first");
    const second = page.invokeWebMCPTool("frame-1", "second");
    await vi.waitFor(() => expect(resolvers.size).toBe(2));

    resolvers.get("second")!();
    await second;
    resolvers.get("first")!();
    await first;

    await expect(
      page.waitForWebMCPInvocationResult("first-invocation", { timeout: 10 }),
    ).resolves.toMatchObject({ output: "first" });
    await expect(
      page.waitForWebMCPInvocationResult("second-invocation", { timeout: 10 }),
    ).resolves.toMatchObject({ output: "second" });
  });

  it("discards early responses for unknown invocations once no command is pending", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": (currentSession) => {
        currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
          invocationId: "invocation-2",
          status: "Completed",
          output: "stale",
        });
        return { invocationId: "invocation-1" };
      },
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "first");

    session.responses["WebMCP.invokeTool"] = () => ({ invocationId: "invocation-2" });
    await page.invokeWebMCPTool("frame-1", "second");
    const result = page.waitForWebMCPInvocationResult("invocation-2");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-2",
      status: "Completed",
      output: "fresh",
    });

    await expect(result).resolves.toMatchObject({ output: "fresh" });
  });

  it("discards early responses when the last pending command fails", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "existing-invocation" }),
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "existing");
    session.responses["WebMCP.invokeTool"] = (currentSession) => {
      currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
        invocationId: "invocation-1",
        status: "Completed",
        output: "stale",
      });
      throw new Error("Invocation failed");
    };
    await expect(page.invokeWebMCPTool("frame-1", "search")).rejects.toThrow("Invocation failed");
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(1);

    session.responses["WebMCP.invokeTool"] = () => ({ invocationId: "invocation-1" });
    await page.invokeWebMCPTool("frame-1", "retry");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
      output: "fresh",
    });
    await expect(page.waitForWebMCPInvocationResult("invocation-1")).resolves.toMatchObject({
      output: "fresh",
    });
  });

  it("does not claim an early response buffered by another session", async () => {
    let resolveMain!: (response: Protocol.WebMCP.InvokeToolResponse) => void;
    let markCommandSent!: () => void;
    const commandSent = new Promise<void>((resolve) => {
      markCommandSent = resolve;
    });
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () =>
        new Promise<Protocol.WebMCP.InvokeToolResponse>((resolve) => {
          resolveMain = resolve;
          markCommandSent();
        }),
    });
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": (currentSession) => {
          const event = { invocationId: "child-invocation", status: "Completed" as const };
          session.emit("WebMCP.toolResponded", { ...event, output: "wrong session" });
          currentSession.emit("WebMCP.toolResponded", { ...event, output: "child" });
          return { invocationId: "child-invocation" };
        },
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);
    const mainInvocation = page.invokeWebMCPTool("frame-1", "main");
    await commandSent;
    await page.invokeWebMCPTool("frame-2", "child");
    resolveMain({ invocationId: "main-invocation" });
    await mainInvocation;

    await expect(
      page.waitForWebMCPInvocationResult("child-invocation", { timeout: 10 }),
    ).resolves.toMatchObject({ output: "child" });
  });

  it("times out only the current result caller and allows a later retry", async () => {
    vi.useFakeTimers();
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "search");

    const timedWait = page.waitForWebMCPInvocationResult("invocation-1", { timeout: 10 });
    const timedExpectation = expect(timedWait).rejects.toThrow(
      'Timed out waiting for WebMCP tool "search" invocation "invocation-1" after 10ms.',
    );
    await vi.advanceTimersByTimeAsync(10);
    await timedExpectation;
    expect(session.callsFor("WebMCP.cancelInvocation")).toHaveLength(0);

    const retry = page.waitForWebMCPInvocationResult("invocation-1");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
      output: "done",
    });
    await expect(retry).resolves.toStrictEqual({
      invocationId: "invocation-1",
      status: "Completed",
      output: "done",
    });
  });

  it("requests cancellation without locally settling the invocation", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "search");

    await page.cancelWebMCPInvocation("invocation-1");
    expect(session.callsFor("WebMCP.cancelInvocation")).toStrictEqual([
      {
        method: "WebMCP.cancelInvocation",
        params: { invocationId: "invocation-1" },
      },
    ]);

    const result = page.waitForWebMCPInvocationResult("invocation-1");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Canceled",
    });
    await expect(result).resolves.toStrictEqual({
      invocationId: "invocation-1",
      status: "Canceled",
    });
  });

  it("rejects unknown invocation IDs before result or cancellation operations", async () => {
    const session = new FakeCDPSession();
    const page = createPage(session);

    await expect(page.waitForWebMCPInvocationResult("missing")).rejects.toThrow(
      'WebMCP invocation "missing" was not found on page "target-1".',
    );
    await expect(page.cancelWebMCPInvocation("missing")).rejects.toThrow(
      'WebMCP invocation "missing" was not found on page "target-1".',
    );
    expect(session.callsFor("WebMCP.cancelInvocation")).toHaveLength(0);
  });

  it("rejects pending waits and removes the response listener when the page closes", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "search");
    const result = page.waitForWebMCPInvocationResult("invocation-1");

    await page.close();

    await expect(result).rejects.toThrow(
      'WebMCP invocation "invocation-1" was disposed before it completed on page "target-1".',
    );
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
    await expect(page.waitForWebMCPInvocationResult("invocation-1")).rejects.toThrow(
      'WebMCP invocation "invocation-1" was not found on page "target-1".',
    );
  });

  it.each([
    [
      "detached target",
      (context: BrowserContext) => context.onDetachedFromTarget("main", "target-1"),
    ],
    ["destroyed target", (context: BrowserContext) => context.cleanupByTarget("target-1")],
  ])("cleans up pending invocations for a %s", async (_event, removeTarget) => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const { context, page } = createContextPage(session);
    await page.invokeWebMCPTool("frame-1", "search");
    const result = page.waitForWebMCPInvocationResult("invocation-1");
    const rejection = expect(result).rejects.toThrow(
      'WebMCP invocation "invocation-1" was disposed before it completed on page "target-1".',
    );

    removeTarget(context);

    await rejection;
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
    expect(context.pagesByTarget.has("target-1")).toBe(false);
  });

  it.each(["before", "after"])(
    "evicts results delivered %s registration after retention",
    async (timing) => {
      vi.useFakeTimers();
      const event: Protocol.WebMCP.ToolRespondedEvent = {
        invocationId: "invocation-1",
        status: "Completed",
      };
      const session = new FakeCDPSession({
        "WebMCP.invokeTool": (currentSession) => {
          if (timing === "before") currentSession.emit("WebMCP.toolResponded", event);
          return { invocationId: "invocation-1" };
        },
      });
      const page = createPage(session);
      await page.invokeWebMCPTool("frame-1", "search");
      if (timing === "after") session.emit("WebMCP.toolResponded", event);
      await expect(page.waitForWebMCPInvocationResult("invocation-1")).resolves.toStrictEqual({
        invocationId: "invocation-1",
        status: "Completed",
      });

      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

      await expect(page.waitForWebMCPInvocationResult("invocation-1")).rejects.toThrow(
        'WebMCP invocation "invocation-1" was not found on page "target-1".',
      );
      expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
    },
  );

  it("detaching an OOPIF rejects only that session's pending invocations", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "main-invocation" }),
    });
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": () => ({ invocationId: "child-invocation" }),
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);
    await page.invokeWebMCPTool("frame-1", "main");
    await page.invokeWebMCPTool("frame-2", "child");
    const mainResult = page.waitForWebMCPInvocationResult("main-invocation");
    const childResult = page.waitForWebMCPInvocationResult("child-invocation");
    const childRejection = expect(childResult).rejects.toThrow(
      'WebMCP invocation "child-invocation" was disposed before it completed because its frame detached from page "target-1".',
    );

    page.detachOopifSession("child");

    await childRejection;
    expect(childSession.listenerCount("WebMCP.toolResponded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(1);
    await expect(page.waitForWebMCPInvocationResult("child-invocation")).rejects.toThrow(
      'WebMCP invocation "child-invocation" was not found on page "target-1".',
    );

    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "main-invocation",
      status: "Completed",
    });
    await expect(mainResult).resolves.toStrictEqual({
      invocationId: "main-invocation",
      status: "Completed",
    });
  });

  it.each(["detach", "dispose"])(
    "clears early responses on %s while a command is pending",
    async (action) => {
      let resolveInvocation!: (response: Protocol.WebMCP.InvokeToolResponse) => void;
      let markCommandSent!: () => void;
      const commandSent = new Promise<void>((resolve) => {
        markCommandSent = resolve;
      });
      const session = new FakeCDPSession();
      const childSession = new FakeCDPSession(
        {
          "WebMCP.invokeTool": (currentSession) =>
            new Promise<Protocol.WebMCP.InvokeToolResponse>((resolve) => {
              currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
                invocationId: "orphaned-invocation",
                status: "Completed",
                output: "early",
              });
              resolveInvocation = resolve;
              markCommandSent();
            }),
        },
        "child",
      );
      const page = createPage(session);
      adoptChildSession(page, childSession);
      const invocation = page.invokeWebMCPTool("frame-2", "child");
      await commandSent;

      // The pending command retains this state even after it leaves the page's map.
      const responses = page["webMCPResponseSessions"].get(childSession)!.earlyResponses;
      expect(responses.size).toBe(1);
      if (action === "detach") page.detachOopifSession("child");
      else page.dispose();
      expect(responses.size).toBe(0);
      resolveInvocation({ invocationId: "orphaned-invocation" });

      await expect(invocation).rejects.toThrow(
        'WebMCP session for frame "frame-2" was disposed before invocation registration completed on page "target-1".',
      );
      expect(childSession.listenerCount("WebMCP.toolResponded")).toBe(0);
      await expect(page.waitForWebMCPInvocationResult("orphaned-invocation")).rejects.toThrow(
        'WebMCP invocation "orphaned-invocation" was not found on page "target-1".',
      );
    },
  );

  it("page disposal rejects invocations and removes listeners across every session", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "main-invocation" }),
    });
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": () => ({ invocationId: "child-invocation" }),
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);
    await page.invokeWebMCPTool("frame-1", "main");
    await page.invokeWebMCPTool("frame-2", "child");
    const mainResult = page.waitForWebMCPInvocationResult("main-invocation");
    const childResult = page.waitForWebMCPInvocationResult("child-invocation");
    const mainRejection = expect(mainResult).rejects.toThrow(
      'WebMCP invocation "main-invocation" was disposed before it completed on page "target-1".',
    );
    const childRejection = expect(childResult).rejects.toThrow(
      'WebMCP invocation "child-invocation" was disposed before it completed on page "target-1".',
    );

    page.dispose();

    await Promise.all([mainRejection, childRejection]);
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
    expect(childSession.listenerCount("WebMCP.toolResponded")).toBe(0);
  });

  it("rejects duplicate invocation IDs returned by different sessions", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "duplicate" }),
    });
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": () => ({ invocationId: "duplicate" }),
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);
    await page.invokeWebMCPTool("frame-1", "main");

    await expect(page.invokeWebMCPTool("frame-2", "child")).rejects.toThrow(
      'WebMCP returned duplicate invocation ID "duplicate".',
    );
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(1);
    expect(childSession.listenerCount("WebMCP.toolResponded")).toBe(0);
  });

  it("rejects an unknown frame without installing a listener or sending an invocation", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => {
        throw new Error("Tool not found");
      },
    });
    const page = createPage(session);

    await expect(page.invokeWebMCPTool("stale-frame", "search")).rejects.toThrow(
      'WebMCP frame "stale-frame" was not found on page "target-1" or has detached.',
    );
    expect(session.callsFor("WebMCP.invokeTool")).toHaveLength(0);
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
  });

  it("removes an idle child-session response listener when invocation fails", async () => {
    const session = new FakeCDPSession();
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": () => {
          throw new Error("Tool not found");
        },
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);

    await expect(page.invokeWebMCPTool("frame-2", "search")).rejects.toThrow("Tool not found");
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
    expect(childSession.listenerCount("WebMCP.toolResponded")).toBe(0);
  });
});

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

  it("evicts settled invocation records after bounded retention", async () => {
    vi.useFakeTimers();
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = createPage(session);
    await page.invokeWebMCPTool("frame-1", "search");
    session.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
    });
    await expect(page.waitForWebMCPInvocationResult("invocation-1")).resolves.toStrictEqual({
      invocationId: "invocation-1",
      status: "Completed",
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

    await expect(page.waitForWebMCPInvocationResult("invocation-1")).rejects.toThrow(
      'WebMCP invocation "invocation-1" was not found on page "target-1".',
    );
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
  });

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

  it("does not register an invocation whose child session detached during the command", async () => {
    let resolveInvocation!: (response: Protocol.WebMCP.InvokeToolResponse) => void;
    const session = new FakeCDPSession();
    const childSession = new FakeCDPSession(
      {
        "WebMCP.invokeTool": () =>
          new Promise<Protocol.WebMCP.InvokeToolResponse>((resolve) => {
            resolveInvocation = resolve;
          }),
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);
    const invocation = page.invokeWebMCPTool("frame-2", "child");
    await Promise.resolve();

    page.detachOopifSession("child");
    resolveInvocation({ invocationId: "orphaned-invocation" });

    await expect(invocation).rejects.toThrow(
      'WebMCP session for frame "frame-2" was disposed before invocation registration completed on page "target-1".',
    );
    expect(childSession.listenerCount("WebMCP.toolResponded")).toBe(0);
    await expect(page.waitForWebMCPInvocationResult("orphaned-invocation")).rejects.toThrow(
      'WebMCP invocation "orphaned-invocation" was not found on page "target-1".',
    );
  });

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

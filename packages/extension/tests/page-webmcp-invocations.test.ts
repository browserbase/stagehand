import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { ChromeTabTargetController } from "../understudy/chromeTabs.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { BrowserContext } from "../understudy/context.js";
import { Page } from "../understudy/page.js";

class FakeCDPSession implements CDPSessionLike {
  readonly id = "main";
  readonly calls: Array<{ method: string; params?: object }> = [];
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();

  constructor(
    readonly responses: Record<string, (session: FakeCDPSession, params?: object) => unknown> = {},
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

  it("retains a terminal response delivered before invokeTool resolves", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": (currentSession) => {
        currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
          invocationId: "invocation-1",
          status: "Completed",
          output: { value: "early" },
        });
        return { invocationId: "invocation-1" };
      },
    });
    const page = createPage(session);

    await page.invokeWebMCPTool("frame-1", "search");

    await expect(
      page.waitForWebMCPInvocationResult("invocation-1", { timeout: 10 }),
    ).resolves.toStrictEqual({
      invocationId: "invocation-1",
      status: "Completed",
      output: { value: "early" },
    });
  });

  it("matches early terminal responses to concurrent invocations", async () => {
    let invocation = 0;
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": (currentSession) => {
        const invocationId = `invocation-${++invocation}`;
        currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
          invocationId,
          status: "Completed",
          output: invocationId,
        });
        return { invocationId };
      },
    });
    const page = createPage(session);

    await Promise.all([
      page.invokeWebMCPTool("frame-1", "first"),
      page.invokeWebMCPTool("frame-1", "second"),
    ]);

    await expect(page.waitForWebMCPInvocationResult("invocation-1")).resolves.toMatchObject({
      output: "invocation-1",
    });
    await expect(page.waitForWebMCPInvocationResult("invocation-2")).resolves.toMatchObject({
      output: "invocation-2",
    });
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(1);
  });

  it("never evicts a retained early response when the bounded buffer overflows", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": (currentSession) => {
        currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
          invocationId: "invocation-1",
          status: "Completed",
          output: "matched",
        });
        for (let index = 0; index < 150; index += 1) {
          currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
            invocationId: `unrelated-${index}`,
            status: "Completed",
          });
        }
        return { invocationId: "invocation-1" };
      },
    });
    const page = createPage(session);

    await page.invokeWebMCPTool("frame-1", "search");

    await expect(page.waitForWebMCPInvocationResult("invocation-1")).resolves.toMatchObject({
      output: "matched",
    });
  });

  it("fails explicitly when overflow may have dropped an early response", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": (currentSession) => {
        for (let index = 0; index < 150; index += 1) {
          currentSession.emit<Protocol.WebMCP.ToolRespondedEvent>("WebMCP.toolResponded", {
            invocationId: `unrelated-${index}`,
            status: "Completed",
          });
        }
        return { invocationId: "invocation-1" };
      },
    });
    const page = createPage(session);

    await expect(page.invokeWebMCPTool("frame-1", "search")).rejects.toThrow(
      'WebMCP response buffer overflowed before invocation "invocation-1" could be registered.',
    );
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
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

  it("removes an idle response listener when invocation fails", async () => {
    const session = new FakeCDPSession({
      "WebMCP.invokeTool": () => {
        throw new Error("Tool not found");
      },
    });
    const page = createPage(session);

    await expect(page.invokeWebMCPTool("stale-frame", "search")).rejects.toThrow("Tool not found");
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
  });
});

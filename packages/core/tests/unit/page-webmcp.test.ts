import { describe, expect, it } from "vitest";
import { Page } from "../../lib/v3/understudy/page.js";
import type {
  WebMCPTool,
  WebMCPToolInvocation,
  WebMCPToolInvocationOptions,
  WebMCPListToolsOptions,
} from "../../lib/v3/types/public/page.js";
import type { CdpConnection } from "../../lib/v3/understudy/cdp.js";
import {
  StagehandInvalidArgumentError,
  StagehandUnsupportedBrowserFeatureError,
} from "../../lib/v3/types/public/sdkErrors.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";

type WebMCPPageStub = {
  listWebMCPTools: (options?: WebMCPListToolsOptions) => Promise<WebMCPTool[]>;
  invokeWebMCPTool: (
    toolName: string,
    input: Record<string, unknown>,
    options?: WebMCPToolInvocationOptions,
  ) => Promise<WebMCPToolInvocation>;
  close: () => Promise<void>;
};

type PageRuntimeConstructor = new (
  conn: CdpConnection,
  mainSession: MockCDPSession,
  targetId: string,
  mainFrameId: string,
) => WebMCPPageStub;

const wait = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function makePage(session: MockCDPSession): WebMCPPageStub {
  const conn = {
    getTargets: async (): Promise<Array<{ targetId: string }>> => [],
  } as unknown as CdpConnection;
  const PageCtor = Page as unknown as PageRuntimeConstructor;
  return new PageCtor(conn, session, "target-1", "main-frame");
}

describe("Page WebMCP", () => {
  it("collects a per-call tool snapshot from WebMCP.enable and removes the temporary tools listener", async () => {
    const session = new MockCDPSession(
      {
        "WebMCP.enable": () => {
          session.emit("WebMCP.toolsAdded", {
            tools: [
              {
                name: "echo",
                description: "Echo input",
                inputSchema: { type: "object" },
                annotations: { title: "Echo" },
                frameId: "frame-1",
                stackTrace: "debug-only",
              },
            ],
          });
        },
      },
      "main",
    );
    const page = makePage(session);

    const tools = await page.listWebMCPTools({ timeoutMs: 1 });

    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
    expect(tools).toEqual([
      {
        name: "echo",
        description: "Echo input",
        inputSchema: { type: "object" },
        annotations: { title: "Echo" },
        frameId: "frame-1",
      },
    ]);
  });

  it("does not reuse stale tools across listWebMCPTools calls", async () => {
    let enableCount = 0;
    const session = new MockCDPSession({
      "WebMCP.enable": () => {
        enableCount += 1;
        session.emit("WebMCP.toolsAdded", {
          tools: [
            {
              name: `tool-${enableCount}`,
              frameId: `frame-${enableCount}`,
            },
          ],
        });
      },
    });
    const page = makePage(session);

    await expect(page.listWebMCPTools({ timeoutMs: 1 })).resolves.toEqual([
      { name: "tool-1", frameId: "frame-1" },
    ]);
    await expect(page.listWebMCPTools({ timeoutMs: 1 })).resolves.toEqual([
      { name: "tool-2", frameId: "frame-2" },
    ]);

    expect(session.callsFor("WebMCP.enable")).toHaveLength(2);
  });

  it("removes tools from the snapshot when WebMCP.toolsRemoved fires during collection", async () => {
    const session = new MockCDPSession({
      "WebMCP.enable": () => {
        session.emit("WebMCP.toolsAdded", {
          tools: [
            { name: "stale", description: "Stale tool", frameId: "frame-1" },
            { name: "fresh", description: "Fresh tool", frameId: "frame-1" },
          ],
        });
        session.emit("WebMCP.toolsRemoved", {
          tools: [
            { name: "stale", description: "Stale tool", frameId: "frame-1" },
          ],
        });
      },
    });
    const page = makePage(session);

    await expect(page.listWebMCPTools({ timeoutMs: 1 })).resolves.toEqual([
      { name: "fresh", description: "Fresh tool", frameId: "frame-1" },
    ]);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });

  it("throws a browser feature error when WebMCP.enable is unsupported while listing", async () => {
    const session = new MockCDPSession({
      "WebMCP.enable": () => {
        throw new Error("Method not found");
      },
    });
    const page = makePage(session);

    await expect(page.listWebMCPTools({ timeoutMs: 1 })).rejects.toThrow(
      StagehandUnsupportedBrowserFeatureError,
    );
    await expect(page.listWebMCPTools({ timeoutMs: 1 })).rejects.toThrow(
      "Chrome/Chromium newer than version 149",
    );
    await expect(page.listWebMCPTools({ timeoutMs: 1 })).rejects.toThrow(
      "Stagehand's local Chrome launcher enables WebMCP flags by default",
    );
  });

  it("invokes a tool with an explicit frameId and resolves the response event", async () => {
    const session = new MockCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = makePage(session);

    const invocation = await page.invokeWebMCPTool(
      "echo",
      { text: "hello" },
      { frameId: "frame-1", timeoutMs: 100 },
    );
    session.emit("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
      output: { text: "hello" },
    });

    await expect(invocation.result).resolves.toEqual({
      invocationId: "invocation-1",
      status: "Completed",
      output: { text: "hello" },
    });
    expect(session.callsFor("WebMCP.invokeTool")[0]?.params).toEqual({
      frameId: "frame-1",
      toolName: "echo",
      input: { text: "hello" },
    });
  });

  it("throws a browser feature error when invokeTool is unsupported", async () => {
    const session = new MockCDPSession({
      "WebMCP.invokeTool": () => {
        const error = new Error("Method not found");
        Object.assign(error, { code: -32601 });
        throw error;
      },
    });
    const page = makePage(session);

    await expect(
      page.invokeWebMCPTool("echo", {}, { frameId: "frame-1", timeoutMs: 1 }),
    ).rejects.toThrow(StagehandUnsupportedBrowserFeatureError);
    await expect(
      page.invokeWebMCPTool("echo", {}, { frameId: "frame-1", timeoutMs: 1 }),
    ).rejects.toThrow("Chrome/Chromium newer than version 149");
  });

  it("rethrows invokeTool argument or state errors without classifying them as unsupported browser features", async () => {
    const invocationError = new Error(
      "No tool named echo is registered in frame-1",
    );
    const session = new MockCDPSession({
      "WebMCP.invokeTool": () => {
        throw invocationError;
      },
    });
    const page = makePage(session);

    const error = await page
      .invokeWebMCPTool("echo", {}, { frameId: "frame-1", timeoutMs: 1 })
      .catch((caught: unknown) => caught);

    expect(error).toBe(invocationError);
    expect(error).not.toBeInstanceOf(StagehandUnsupportedBrowserFeatureError);
  });

  it("uses listWebMCPTools to resolve a unique frameId when omitted", async () => {
    const session = new MockCDPSession({
      "WebMCP.enable": () => {
        session.emit("WebMCP.toolsAdded", {
          tools: [{ name: "echo", frameId: "frame-1" }],
        });
      },
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = makePage(session);

    const invocation = await page.invokeWebMCPTool(
      "echo",
      {},
      { timeoutMs: 100 },
    );
    session.emit("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
    });

    expect(session.callsFor("WebMCP.invokeTool")[0]?.params).toMatchObject({
      frameId: "frame-1",
      toolName: "echo",
    });
    await expect(invocation.result).resolves.toMatchObject({
      invocationId: "invocation-1",
      status: "Completed",
    });
  });

  it("throws when a tool name is ambiguous across frames", async () => {
    const session = new MockCDPSession({
      "WebMCP.enable": () => {
        session.emit("WebMCP.toolsAdded", {
          tools: [
            { name: "echo", frameId: "frame-1" },
            { name: "echo", frameId: "frame-2" },
          ],
        });
      },
    });
    const page = makePage(session);

    await expect(
      page.invokeWebMCPTool("echo", {}, { timeoutMs: 1 }),
    ).rejects.toThrow(StagehandInvalidArgumentError);
    await expect(
      page.invokeWebMCPTool("echo", {}, { timeoutMs: 1 }),
    ).rejects.toThrow("multiple frames");
  });

  it("rejects invocation.result when the response times out", async () => {
    const session = new MockCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = makePage(session);

    const invocation = await page.invokeWebMCPTool(
      "slow",
      {},
      { frameId: "frame-1", timeoutMs: 1 },
    );

    await expect(invocation.result).rejects.toThrow(
      'Timed out waiting for WebMCP tool "slow"',
    );
  });

  it("buffers a response event that arrives before invokeTool returns", async () => {
    const session = new MockCDPSession({
      "WebMCP.invokeTool": async () => {
        session.emit("WebMCP.toolResponded", {
          invocationId: "invocation-1",
          status: "Completed",
          output: "early",
        });
        await wait();
        return { invocationId: "invocation-1" };
      },
    });
    const page = makePage(session);

    const invocation = await page.invokeWebMCPTool(
      "early",
      {},
      { frameId: "frame-1", timeoutMs: 100 },
    );

    await expect(invocation.result).resolves.toEqual({
      invocationId: "invocation-1",
      status: "Completed",
      output: "early",
    });
  });

  it("does not buffer late responses after an invocation times out", async () => {
    let invokeCount = 0;
    const session = new MockCDPSession({
      "WebMCP.invokeTool": () => {
        invokeCount += 1;
        return { invocationId: "invocation-1" };
      },
    });
    const page = makePage(session);

    const timedOutInvocation = await page.invokeWebMCPTool(
      "slow",
      {},
      { frameId: "frame-1", timeoutMs: 1 },
    );
    await expect(timedOutInvocation.result).rejects.toThrow(
      'Timed out waiting for WebMCP tool "slow"',
    );

    session.emit("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
      output: "late",
    });

    const currentInvocation = await page.invokeWebMCPTool(
      "current",
      {},
      { frameId: "frame-1", timeoutMs: 100 },
    );
    expect(invokeCount).toBe(2);

    session.emit("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Completed",
      output: "current",
    });

    await expect(currentInvocation.result).resolves.toEqual({
      invocationId: "invocation-1",
      status: "Completed",
      output: "current",
    });
  });

  it("sends cancelInvocation without removing the pending result listener", async () => {
    const session = new MockCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = makePage(session);

    const invocation = await page.invokeWebMCPTool(
      "cancelable",
      {},
      { frameId: "frame-1", timeoutMs: 100 },
    );
    await invocation.cancel();
    session.emit("WebMCP.toolResponded", {
      invocationId: "invocation-1",
      status: "Canceled",
    });

    expect(session.callsFor("WebMCP.cancelInvocation")[0]?.params).toEqual({
      invocationId: "invocation-1",
    });
    await expect(invocation.result).resolves.toEqual({
      invocationId: "invocation-1",
      status: "Canceled",
    });
  });

  it("removes persistent WebMCP response listener and rejects pending invocations on close", async () => {
    const session = new MockCDPSession({
      "WebMCP.invokeTool": () => ({ invocationId: "invocation-1" }),
    });
    const page = makePage(session);

    const invocation = await page.invokeWebMCPTool(
      "pending",
      {},
      { frameId: "frame-1", timeoutMs: 100 },
    );
    expect(session.listenerCount("WebMCP.toolResponded")).toBe(1);

    await page.close();

    expect(session.listenerCount("WebMCP.toolResponded")).toBe(0);
    await expect(invocation.result).rejects.toThrow(
      'WebMCP invocation "invocation-1" was disposed',
    );
  });
});

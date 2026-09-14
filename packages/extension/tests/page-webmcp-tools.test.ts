import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike } from "../understudy/cdp.js";
import type { CdpConnection } from "../understudy/cdp.js";
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
  return new Page({} as CdpConnection, session, "target-1", "frame-1", {} as StagehandLogger);
}

function adoptChildSession(page: Page, session: FakeCDPSession): void {
  page.adoptOopifSession(session, "frame-2");
}

describe("Page WebMCP tool discovery", () => {
  it("collects a fresh tool snapshot and removes registration debug data", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": (activeSession) => {
        activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
          tools: [
            {
              name: "search",
              description: "Search the current site",
              inputSchema: {
                type: "object",
                properties: { searchQuery: { type: "string" } },
              },
              annotations: {
                readOnly: true,
                untrustedContent: true,
                autosubmit: false,
              },
              frameId: "frame-1",
              backendNodeId: 42,
              stackTrace: {
                callFrames: [
                  {
                    functionName: "register",
                    scriptId: "1",
                    url: "https://example.test/app.js",
                    lineNumber: 1,
                    columnNumber: 2,
                  },
                ],
              },
            },
          ],
        });
      },
    });
    const page = createPage(session);

    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      {
        name: "search",
        description: "Search the current site",
        inputSchema: {
          type: "object",
          properties: { searchQuery: { type: "string" } },
        },
        annotations: {
          readOnly: true,
          untrustedContent: true,
          autosubmit: false,
        },
        frameId: "frame-1",
        backendNodeId: 42,
      },
    ]);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });

  it("does not reuse tools between snapshots", async () => {
    let enableCount = 0;
    const session = new FakeCDPSession({
      "WebMCP.enable": (activeSession) => {
        enableCount += 1;
        activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
          tools: [
            {
              name: `tool-${enableCount}`,
              description: `Tool ${enableCount}`,
              frameId: `frame-${enableCount}`,
            },
          ],
        });
      },
    });
    const page = createPage(session);

    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "tool-1", description: "Tool 1", frameId: "frame-1" },
    ]);
    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "tool-2", description: "Tool 2", frameId: "frame-2" },
    ]);
  });

  it("collects tools from the main session and an adopted child session", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": (activeSession) => {
        activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
          tools: [{ name: "search", description: "Main-frame search", frameId: "frame-1" }],
        });
      },
    });
    const childSession = new FakeCDPSession(
      {
        "WebMCP.enable": (activeSession) => {
          activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
            tools: [{ name: "search", description: "Child-frame search", frameId: "frame-2" }],
          });
        },
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);

    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "search", description: "Main-frame search", frameId: "frame-1" },
      { name: "search", description: "Child-frame search", frameId: "frame-2" },
    ]);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(childSession.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
    expect(childSession.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(childSession.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });

  it("applies child-session removals to the combined snapshot", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": (activeSession) => {
        activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
          tools: [{ name: "search", description: "Main-frame search", frameId: "frame-1" }],
        });
      },
    });
    const childSession = new FakeCDPSession(
      {
        "WebMCP.enable": (activeSession) => {
          activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
            tools: [
              { name: "search", description: "Stale child search", frameId: "frame-2" },
              { name: "checkout", description: "Child checkout", frameId: "frame-2" },
            ],
          });
          activeSession.emit<Protocol.WebMCP.ToolsRemovedEvent>("WebMCP.toolsRemoved", {
            tools: [{ name: "search", frameId: "frame-2" }],
          });
        },
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);

    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "search", description: "Main-frame search", frameId: "frame-1" },
      { name: "checkout", description: "Child checkout", frameId: "frame-2" },
    ]);
  });

  it("uses a stable session snapshot and discovers newly adopted sessions on the next call", async () => {
    const childSession = new FakeCDPSession(
      {
        "WebMCP.enable": (activeSession) => {
          activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
            tools: [{ name: "child", description: "Child tool", frameId: "frame-2" }],
          });
        },
      },
      "child",
    );
    let page: Page;
    let childAdopted = false;
    const session = new FakeCDPSession({
      "WebMCP.enable": (activeSession) => {
        activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
          tools: [{ name: "main", description: "Main tool", frameId: "frame-1" }],
        });
        if (!childAdopted) {
          childAdopted = true;
          adoptChildSession(page, childSession);
        }
      },
    });
    page = createPage(session);

    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "main", description: "Main tool", frameId: "frame-1" },
    ]);
    expect(childSession.callsFor("WebMCP.enable")).toHaveLength(0);

    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "main", description: "Main tool", frameId: "frame-1" },
      { name: "child", description: "Child tool", frameId: "frame-2" },
    ]);
    expect(childSession.callsFor("WebMCP.enable")).toHaveLength(1);
  });

  it("removes tools unregistered while collecting the snapshot", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": (activeSession) => {
        activeSession.emit<Protocol.WebMCP.ToolsAddedEvent>("WebMCP.toolsAdded", {
          tools: [
            { name: "stale", description: "Stale tool", frameId: "frame-1" },
            { name: "fresh", description: "Fresh tool", frameId: "frame-1" },
          ],
        });
        activeSession.emit<Protocol.WebMCP.ToolsRemovedEvent>("WebMCP.toolsRemoved", {
          tools: [{ name: "stale", frameId: "frame-1" }],
        });
      },
    });
    const page = createPage(session);

    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "fresh", description: "Fresh tool", frameId: "frame-1" },
    ]);
  });

  it("removes temporary listeners when enabling WebMCP fails", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": () => {
        throw new Error("Method not found");
      },
    });
    const page = createPage(session);

    await expect(page.listWebMCPTools()).rejects.toThrow("Method not found");
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });

  it("removes temporary listeners from every session when a child enable fails", async () => {
    const session = new FakeCDPSession();
    const childSession = new FakeCDPSession(
      {
        "WebMCP.enable": () => {
          throw new Error("Child WebMCP unavailable");
        },
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, childSession);

    await expect(page.listWebMCPTools()).rejects.toThrow("Child WebMCP unavailable");
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(childSession.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
    expect(childSession.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(childSession.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });

  it("rejects invalid snapshot timeouts before installing listeners", async () => {
    const session = new FakeCDPSession();
    const page = createPage(session);

    await expect(page.listWebMCPTools({ timeout: -1 })).rejects.toThrow();
    expect(session.callsFor("WebMCP.enable")).toHaveLength(0);
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });
});

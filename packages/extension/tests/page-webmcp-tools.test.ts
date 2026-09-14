import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike } from "../understudy/cdp.js";
import type { CdpConnection } from "../understudy/cdp.js";
import { Page, type WebMCPToolsEvent } from "../understudy/page.js";

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

const pages: Page[] = [];
function createPage(session: FakeCDPSession): Page {
  const page = new Page(
    { targetIdForSession: (id: string) => `target-${id}` } as CdpConnection,
    session,
    "target-1",
    "frame-1",
    {
      error: vi.fn(),
    } as unknown as StagehandLogger,
  );
  pages.push(page);
  return page;
}

afterEach(() => {
  for (const page of pages.splice(0)) page.dispose();
  vi.useRealTimers();
});

function adoptChildSession(page: Page, session: FakeCDPSession): void {
  page.adoptOopifSession(session, "frame-2");
}

describe("Page WebMCP tool discovery", () => {
  it("starts tracking during page creation without a discovery call", async () => {
    const session = new FakeCDPSession({
      "Page.getFrameTree": () => ({ frameTree: { frame: { id: "frame-1", loaderId: "initial" } } }),
      "WebMCP.enable": (activeSession) => {
        expect(activeSession.listenerCount("WebMCP.toolsAdded")).toBe(1);
        expect(activeSession.listenerCount("WebMCP.toolsRemoved")).toBe(1);
        activeSession.emit("WebMCP.toolsAdded", {
          tools: [{ name: "initial", description: "Initial", frameId: "frame-1" }],
        });
      },
    });
    const page = await Page.create({} as CdpConnection, session, "target-1", {
      error: vi.fn(),
    } as unknown as StagehandLogger);
    pages.push(page);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([
      { name: "initial", description: "Initial", frameId: "frame-1" },
    ]);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
  });

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
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(1);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(1);
    page.dispose();
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });

  it("shares initialization across concurrent snapshots and applies live changes", async () => {
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

    const [first, second] = await Promise.all([
      page.listWebMCPTools({ timeout: 0 }),
      page.listWebMCPTools({ timeout: 0 }),
    ]);
    expect(first).toStrictEqual([{ name: "tool-1", description: "Tool 1", frameId: "frame-1" }]);
    first[0]!.description = "Changed by caller";
    expect(second[0]!.description).toBe("Tool 1");
    session.emit("WebMCP.toolsRemoved", { tools: [{ name: "tool-1", frameId: "frame-1" }] });
    session.emit("WebMCP.toolsAdded", {
      tools: [{ name: "tool-2", description: "Tool 2", frameId: "frame-1" }],
    });
    await expect(page.listWebMCPTools({ timeout: 1 })).resolves.toStrictEqual([
      { name: "tool-2", description: "Tool 2", frameId: "frame-1" },
    ]);
    expect(enableCount).toBe(1);
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
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(1);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(1);
    expect(childSession.listenerCount("WebMCP.toolsAdded")).toBe(1);
    expect(childSession.listenerCount("WebMCP.toolsRemoved")).toBe(1);
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

  it("seeds an adopted session's nested frames before accepting initial tools", async () => {
    const page = createPage(new FakeCDPSession());
    const child = new FakeCDPSession(
      {
        "Page.getFrameTree": () => ({
          frameTree: {
            frame: { id: "frame-2", parentId: "frame-1" },
            childFrames: [{ frame: { id: "frame-3", parentId: "frame-2" } }],
          },
        }),
        "WebMCP.enable": (session) =>
          session.emit("WebMCP.toolsAdded", {
            tools: [{ name: "nested", description: "Nested", frameId: "frame-3" }],
          }),
      },
      "child",
    );
    adoptChildSession(page, child);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([
      { name: "nested", description: "Nested", frameId: "frame-3" },
    ]);
    page.onFrameDetached("frame-2");
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([]);
  });

  it("initializes newly adopted sessions independently of discovery", async () => {
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
      { name: "child", description: "Child tool", frameId: "frame-2" },
    ]);
    expect(childSession.callsFor("WebMCP.enable")).toHaveLength(1);

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

  it("cleans up failed tracking and retains its error without retrying enablement", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": () => {
        throw new Error("Method not found");
      },
    });
    const page = createPage(session);

    await expect(page.listWebMCPTools()).rejects.toThrow("Method not found");
    await expect(page.listWebMCPTools()).rejects.toThrow("Method not found");
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
  });

  it("preserves healthy tracking when a child enable fails", async () => {
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
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(1);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(1);
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

  it("waits for initialization even with timeout zero", async () => {
    let finishEnable!: () => void;
    const session = new FakeCDPSession({
      "WebMCP.enable": () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    });
    const page = createPage(session);
    const delivered = vi.fn();
    const snapshot = page.listWebMCPTools({ timeout: 0 }).then(delivered);
    await vi.waitFor(() => expect(finishEnable).toBeTypeOf("function"));
    expect(delivered).not.toHaveBeenCalled();
    session.emit("WebMCP.toolsAdded", {
      tools: [{ name: "initial", description: "Initial", frameId: "frame-1" }],
    });
    finishEnable();
    await snapshot;
    expect(delivered).toHaveBeenCalledWith([
      { name: "initial", description: "Initial", frameId: "frame-1" },
    ]);
  });

  it("waits for delayed state changes within a bounded quiet window", async () => {
    vi.useFakeTimers();
    const session = new FakeCDPSession();
    const page = createPage(session);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([]);
    const delivered = vi.fn();
    const snapshot = page.listWebMCPTools({ timeout: 150 }).then(delivered);
    await vi.advanceTimersByTimeAsync(80);
    session.emit("WebMCP.toolsAdded", {
      tools: [{ name: "late", description: "Late", frameId: "frame-1" }],
    });
    await vi.advanceTimersByTimeAsync(69);
    expect(delivered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await snapshot;
    expect(delivered).toHaveBeenCalledWith([
      { name: "late", description: "Late", frameId: "frame-1" },
    ]);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
  });

  it("invalidates replaced documents and detached subtrees but preserves same-document tools", async () => {
    const session = new FakeCDPSession();
    const page = createPage(session);
    await page.listWebMCPTools({ timeout: 0 });
    const frame = {
      id: "frame-1",
      loaderId: "document-1",
      url: "https://example.test/",
    } as Protocol.Page.Frame;
    page.onFrameNavigated(frame, session);
    page.onFrameAttached("frame-2", "frame-1", session);
    page.onFrameAttached("frame-3", "frame-2", session);
    const tools = ["frame-1", "frame-2", "frame-3"].map((frameId) => ({
      name: "search",
      description: "Search",
      frameId,
    }));
    session.emit("WebMCP.toolsAdded", { tools });
    page.onNavigatedWithinDocument("frame-1", "https://example.test/#hash", session);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual(tools);
    page.onFrameDetached("frame-2");
    session.emit("WebMCP.toolsAdded", { tools: tools.slice(1) });
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([tools[0]]);
    page.onFrameNavigated({ ...frame, loaderId: "document-2" }, session);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([]);
    session.emit("WebMCP.toolsAdded", { tools: [tools[0]] });
    page.onFrameNavigated({ ...frame, loaderId: "document-2" }, session);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([tools[0]]);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
  });

  it("ignores detached session events and late initialization completion", async () => {
    const session = new FakeCDPSession();
    let finishEnable!: () => void;
    const child = new FakeCDPSession(
      {
        "WebMCP.enable": () =>
          new Promise<void>((resolve) => {
            finishEnable = resolve;
          }),
      },
      "child",
    );
    const page = createPage(session);
    adoptChildSession(page, child);
    await vi.waitFor(() => expect(finishEnable).toBeTypeOf("function"));
    const lateEvent = [...child.handlers.get("WebMCP.toolsAdded")!][0]!;
    page.detachOopifSession("child");
    finishEnable();
    lateEvent({ tools: [{ name: "stale", description: "Stale", frameId: "frame-2" }] });
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([]);
    expect(child.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(child.listenerCount("WebMCP.toolsRemoved")).toBe(0);
    const replacement = new FakeCDPSession(
      {
        "WebMCP.enable": (activeSession) =>
          activeSession.emit("WebMCP.toolsAdded", {
            tools: [{ name: "new", description: "New", frameId: "frame-2" }],
          }),
      },
      "child",
    );
    adoptChildSession(page, replacement);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([
      { name: "new", description: "New", frameId: "frame-2" },
    ]);
    lateEvent({ tools: [{ name: "stale", description: "Stale", frameId: "frame-2" }] });
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toHaveLength(1);
  });

  it("rejects discovery during setup when the page is disposed", async () => {
    let finishEnable!: () => void;
    const session = new FakeCDPSession({
      "WebMCP.enable": () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    });
    const page = createPage(session);
    const snapshot = expect(page.listWebMCPTools({ timeout: 0 })).rejects.toThrow("disposed");
    await vi.waitFor(() => expect(finishEnable).toBeTypeOf("function"));
    page.dispose();
    finishEnable();
    await snapshot;
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(0);
    expect(session.listenerCount("WebMCP.toolsRemoved")).toBe(0);
    await expect(page.listWebMCPTools()).rejects.toThrow("disposed");
  });

  it("activates after initialization without replay and keeps tracking after unsubscribe", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": (active) =>
        active.emit("WebMCP.toolsAdded", {
          tools: [{ name: "initial", description: "Initial", frameId: "frame-1" }],
        }),
    });
    const page = createPage(session);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = await page.subscribeWebMCPToolsChanged(first);
    await page.subscribeWebMCPToolsChanged(second);
    await page.listWebMCPTools({ timeout: 0 });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    unsubscribe();
    session.emit("WebMCP.toolsRemoved", { tools: [{ name: "initial", frameId: "frame-1" }] });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    await expect(page.listWebMCPTools({ timeout: 0 })).resolves.toEqual([]);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(1);
  });

  it("cancels one waiting listener without canceling initialization or another listener", async () => {
    let finishEnable!: () => void;
    const session = new FakeCDPSession({
      "WebMCP.enable": () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    });
    const page = createPage(session);
    const controller = new AbortController();
    const canceled = vi.fn();
    const active = vi.fn();
    const first = expect(
      page.subscribeWebMCPToolsChanged(canceled, controller.signal),
    ).rejects.toThrow("canceled");
    const second = page.subscribeWebMCPToolsChanged(active);
    await vi.waitFor(() => expect(finishEnable).toBeTypeOf("function"));
    controller.abort();
    await first;
    expect(session.listenerCount("WebMCP.toolsAdded")).toBe(1);
    finishEnable();
    await second;
    session.emit("WebMCP.toolsAdded", {
      tools: [{ name: "live", description: "Live", frameId: "frame-1" }],
    });
    expect(canceled).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledTimes(1);
    expect(session.callsFor("WebMCP.enable")).toHaveLength(1);
  });

  it("rejects pending listener activation on disposal and ignores late readiness", async () => {
    let finishEnable!: () => void;
    const session = new FakeCDPSession({
      "WebMCP.enable": () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    });
    const page = createPage(session);
    const listener = vi.fn();
    const pending = expect(page.subscribeWebMCPToolsChanged(listener)).rejects.toThrow("canceled");
    await vi.waitFor(() => expect(finishEnable).toBeTypeOf("function"));
    page.dispose();
    await pending;
    finishEnable();
    await Promise.resolve();
    session.emit("WebMCP.toolsAdded", {
      tools: [{ name: "late", description: "Late", frameId: "frame-1" }],
    });
    expect(listener).not.toHaveBeenCalled();
    await expect(page.subscribeWebMCPToolsChanged(listener)).rejects.toThrow("disposed");
  });

  it("surfaces tracker failure to subscribers without preventing console subscriptions", async () => {
    const session = new FakeCDPSession({
      "WebMCP.enable": () => {
        throw new Error("Unavailable");
      },
    });
    const page = createPage(session);
    await expect(page.subscribeWebMCPToolsChanged(vi.fn())).rejects.toThrow("Unavailable");
    const unsubscribe = await page.subscribeCDPEvent("console", vi.fn());
    expect(session.listenerCount("Runtime.consoleAPICalled")).toBe(1);
    unsubscribe();
    expect(session.listenerCount("Runtime.consoleAPICalled")).toBe(0);
  });

  it("delivers normalized batches after updating discovery and isolates subscribers", async () => {
    const session = new FakeCDPSession();
    const page = createPage(session);
    const events: WebMCPToolsEvent[] = [];
    const snapshots: Array<ReturnType<Page["listWebMCPTools"]>> = [];
    await page.subscribeWebMCPToolsChanged((event) => {
      if (event.event === "toolsadded") event.tools[0]!.description = "Changed by listener";
      throw new Error("listener failed");
    });
    await page.subscribeWebMCPToolsChanged((event) => {
      events.push(event);
      snapshots.push(page.listWebMCPTools({ timeout: 0 }));
    });
    const tools = ["search", "checkout"].map((name) => ({
      name,
      description: name,
      frameId: "frame-1",
      inputSchema: { properties: { searchQuery: { type: "string" } } },
    }));
    session.emit("WebMCP.toolsAdded", {
      tools: tools.map((tool) => ({ ...tool, stackTrace: { callFrames: [] } })),
    });
    expect(events).toEqual([
      {
        event: "toolsadded",
        tools,
        pageId: "target-1",
        sessionId: "main",
        targetId: "target-main",
      },
    ]);
    await expect(snapshots[0]).resolves.toEqual(tools);
    session.emit("WebMCP.toolsAdded", { tools });
    expect(events).toHaveLength(1);
    session.emit("WebMCP.toolsRemoved", {
      tools: [
        { frameId: "frame-1", name: "search" },
        { frameId: "frame-1", name: "unknown" },
      ],
    });
    expect(events[1]).toMatchObject({
      event: "toolsremoved",
      tools: [{ frameId: "frame-1", name: "search" }],
    });
    await expect(snapshots[1]).resolves.toEqual([tools[1]]);
  });

  it("emits document invalidations once and retains same-document registrations", async () => {
    const session = new FakeCDPSession();
    const page = createPage(session);
    const frame = {
      id: "frame-1",
      loaderId: "one",
      url: "https://example.test",
    } as Protocol.Page.Frame;
    page.onFrameNavigated(frame, session);
    const events: WebMCPToolsEvent[] = [];
    await page.subscribeWebMCPToolsChanged((event) => events.push(event));
    const tools = [{ frameId: "frame-1", name: "search", description: "Search" }];
    session.emit("WebMCP.toolsAdded", { tools });
    page.onNavigatedWithinDocument("frame-1", "https://example.test/#hash", session);
    expect(events).toHaveLength(1);
    page.onFrameNavigated({ ...frame, loaderId: "two" }, session);
    session.emit("WebMCP.toolsRemoved", { tools });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event: "toolsremoved",
      tools: [{ frameId: "frame-1", name: "search" }],
    });
    session.emit("WebMCP.toolsAdded", { tools });
    expect(events[2]).toMatchObject({ event: "toolsadded", tools });
    page.dispose();
    expect(events).toHaveLength(3);
  });

  it("delivers future iframe availability and detach removals without restarting tracking", async () => {
    const page = createPage(new FakeCDPSession());
    const events: WebMCPToolsEvent[] = [];
    let afterRemoval: ReturnType<Page["listWebMCPTools"]> | undefined;
    await page.subscribeWebMCPToolsChanged((event) => {
      events.push(event);
      if (event.event === "toolsremoved") afterRemoval = page.listWebMCPTools({ timeout: 0 });
    });
    const child = new FakeCDPSession(
      {
        "WebMCP.enable": (session) =>
          session.emit("WebMCP.toolsAdded", {
            tools: [{ name: "child", description: "Child", frameId: "frame-2" }],
          }),
      },
      "child",
    );
    adoptChildSession(page, child);
    await page.listWebMCPTools({ timeout: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "toolsadded",
      sessionId: "child",
      targetId: "target-child",
    });
    page.detachOopifSession("child");
    await expect(afterRemoval).resolves.toEqual([]);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event: "toolsremoved",
      sessionId: "child",
      targetId: "target-child",
      tools: [{ name: "child", frameId: "frame-2" }],
    });
    expect(child.callsFor("WebMCP.enable")).toHaveLength(1);
    expect(child.listenerCount("WebMCP.toolsAdded")).toBe(0);
  });
});

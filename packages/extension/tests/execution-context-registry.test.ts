import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vite-plus/test";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { ExecutionContextRegistry } from "../understudy/executionContextRegistry.js";

class FakeSession implements CDPSessionLike {
  readonly id = "session-a";
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  readonly readyContexts = new Set<number>();
  readonly calls: Array<{ method: string; params?: object }> = [];
  protocol = "https:";
  fallbackContextId = 11;
  fallbackInstalled = false;

  async send<R = unknown>(method: string, params?: object): Promise<R> {
    this.calls.push({ method, params });
    if (method === "Page.createIsolatedWorld") {
      return { executionContextId: this.fallbackContextId } as R;
    }
    if (method === "Runtime.evaluate") {
      const expression = (params as { expression?: string } | undefined)?.expression ?? "";
      if (expression.includes("location?.protocol")) {
        return { result: { type: "string", value: this.protocol } } as R;
      }
      if (expression.startsWith("install locator runtime")) {
        this.fallbackInstalled = true;
        return { result: { type: "undefined" } } as R;
      }
      if (expression.includes("__stagehandLocatorScripts")) {
        return {
          result: {
            type: "object",
            value: {
              ready: this.fallbackInstalled,
              kind: this.fallbackInstalled ? "cdp-fallback" : "unknown",
              closedShadowRoots: false,
            },
          },
        } as R;
      }
      const contextId = (params as { contextId?: number } | undefined)?.contextId;
      const ready = contextId !== undefined && this.readyContexts.has(contextId);
      return {
        result: {
          type: "object",
          value: {
            ready,
            marker: ready,
            domApi: ready ? "function" : "undefined",
          },
        },
      } as R;
    }
    return {} as R;
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const handlers = this.handlers.get(event) ?? new Set<(params: unknown) => void>();
    handlers.add(handler as (params: unknown) => void);
    this.handlers.set(event, handlers);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }

  async close(): Promise<void> {}

  emit(event: string, params: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }
}

const contextCreated = (
  id: number,
  frameId: string,
  isDefault: boolean,
): Protocol.Runtime.ExecutionContextCreatedEvent =>
  ({
    context: {
      id,
      origin: isDefault ? "https://example.test" : "chrome-extension://stagehand",
      name: isDefault ? "" : "Stagehand",
      uniqueId: `context-${id}`,
      auxData: { frameId, isDefault },
    },
  }) as Protocol.Runtime.ExecutionContextCreatedEvent;

describe("ExecutionContextRegistry", () => {
  it("selects only the isolated context with the Stagehand marker and chrome.dom", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new FakeSession();
    registry.attachSession(session);

    session.emit("Runtime.executionContextCreated", contextCreated(1, "frame-a", true));
    session.emit("Runtime.executionContextCreated", contextCreated(5, "frame-a", false));
    session.emit("Runtime.executionContextCreated", contextCreated(7, "frame-a", false));
    session.readyContexts.add(7);

    await expect(registry.waitForExtensionWorld(session, "frame-a", 50)).resolves.toBe(7);
    await expect(registry.waitForLocatorWorld(session, "frame-a", 50)).resolves.toStrictEqual({
      contextId: 7,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });
    expect(registry.getMainWorld(session, "frame-a")).toBe(1);
    expect(registry.getExtensionWorld(session, "frame-a")).toBe(7);
  });

  it("selects the main context on the packaged extension blank page", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new FakeSession();
    registry.attachSession(session);
    session.readyContexts.add(1);

    session.emit("Runtime.executionContextCreated", contextCreated(1, "frame-a", true));

    await expect(registry.waitForExtensionWorld(session, "frame-a", 50)).resolves.toBe(1);
    expect(registry.getMainWorld(session, "frame-a")).toBe(1);
    expect(registry.getExtensionWorld(session, "frame-a")).toBe(1);
  });

  it("creates and reuses a capability-limited fallback world for data documents", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new FakeSession();
    session.protocol = "data:";
    registry.setFallbackInstallerSource(session, "install locator runtime");
    registry.attachSession(session);
    session.emit("Runtime.executionContextCreated", contextCreated(1, "frame-a", true));

    await expect(registry.waitForLocatorWorld(session, "frame-a", 1)).resolves.toStrictEqual({
      contextId: 11,
      kind: "cdp-fallback",
      capabilities: { closedShadowRoots: false },
    });
    await expect(registry.waitForLocatorWorld(session, "frame-a", 1)).resolves.toStrictEqual({
      contextId: 11,
      kind: "cdp-fallback",
      capabilities: { closedShadowRoots: false },
    });
    expect(
      session.calls.filter(({ method }) => method === "Page.createIsolatedWorld"),
    ).toHaveLength(1);

    session.emit("Runtime.executionContextDestroyed", { executionContextId: 11 });
    expect(registry.getFallbackWorld(session, "frame-a")).toBeNull();
  });

  it("does not mask a missing extension world on an HTTP document", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new FakeSession();
    registry.setFallbackInstallerSource(session, "install locator runtime");
    registry.attachSession(session);
    session.emit("Runtime.executionContextCreated", contextCreated(1, "frame-a", true));

    await expect(registry.waitForLocatorWorld(session, "frame-a", 1)).rejects.toThrow(
      "Stagehand extension world not ready",
    );
    expect(
      session.calls.filter(({ method }) => method === "Page.createIsolatedWorld"),
    ).toHaveLength(0);
  });

  it("invalidates selected extension worlds when their context is destroyed", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new FakeSession();
    registry.attachSession(session);
    session.readyContexts.add(7);
    session.emit("Runtime.executionContextCreated", contextCreated(7, "frame-a", false));
    await registry.waitForExtensionWorld(session, "frame-a", 50);

    session.emit("Runtime.executionContextDestroyed", { executionContextId: 7 });

    expect(registry.getExtensionWorld(session, "frame-a")).toBeNull();
  });

  it("clears main and extension worlds after navigation", async () => {
    const registry = new ExecutionContextRegistry();
    const session = new FakeSession();
    registry.attachSession(session);
    session.readyContexts.add(7);
    session.emit("Runtime.executionContextCreated", contextCreated(1, "frame-a", true));
    session.emit("Runtime.executionContextCreated", contextCreated(7, "frame-a", false));
    await registry.waitForExtensionWorld(session, "frame-a", 50);

    session.emit("Runtime.executionContextsCleared", {});

    expect(registry.getMainWorld(session, "frame-a")).toBeNull();
    expect(registry.getExtensionWorld(session, "frame-a")).toBeNull();
  });
});

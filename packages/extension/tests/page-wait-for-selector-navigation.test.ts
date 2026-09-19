import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { executionContexts } from "../understudy/executionContextRegistry.js";
import { Page } from "../understudy/page.js";

const FRAME_ID = "frame-main";

/**
 * A session whose Runtime.evaluate answers are scripted per locator-world
 * context id: the outgoing document's context rejects the way Chrome rejects a
 * pending evaluate once the navigation commits, the new one resolves.
 */
class FakeSession implements CDPSessionLike {
  readonly id = "session-main";
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  readonly readyContexts = new Set<number>();
  readonly evaluateCalls: Array<{ contextId?: number; expression: string }> = [];
  readonly answers = new Map<number, () => Promise<unknown>>();

  async send<R = unknown>(method: string, params?: object): Promise<R> {
    if (method !== "Runtime.evaluate") return {} as R;
    const { contextId, expression } = params as { contextId?: number; expression: string };
    if (expression.includes("__stagehandExtensionWorld")) {
      const ready = contextId !== undefined && this.readyContexts.has(contextId);
      return { result: { value: { ready, marker: ready, domApi: "function" } } } as R;
    }
    this.evaluateCalls.push({ contextId, expression });
    const answer = contextId !== undefined ? this.answers.get(contextId) : undefined;
    if (!answer) throw new Error(`unexpected evaluate in context ${contextId}`);
    return (await answer()) as R;
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
  isDefault: boolean,
): Protocol.Runtime.ExecutionContextCreatedEvent =>
  ({
    context: {
      id,
      origin: isDefault ? "http://example.test" : "chrome-extension://stagehand",
      name: isDefault ? "" : "Stagehand",
      uniqueId: `context-${id}`,
      auxData: { frameId: FRAME_ID, isDefault },
    },
  }) as Protocol.Runtime.ExecutionContextCreatedEvent;

function createPage(session: FakeSession): Page {
  executionContexts.attachSession(session);
  const connection = {
    targetIdForSession: (sessionId: string) => `target-${sessionId}`,
  } as CdpConnection;
  return new Page(connection, session, "target-main", FRAME_ID, {} as StagehandLogger);
}

function documentReady(session: FakeSession, mainContextId: number, worldContextId: number): void {
  session.emit("Runtime.executionContextCreated", contextCreated(mainContextId, true));
  session.emit("Runtime.executionContextCreated", contextCreated(worldContextId, false));
  session.readyContexts.add(worldContextId);
}

describe("Page.waitForSelector across a navigation", () => {
  it("re-issues the wait in the new document when the commit kills the pending evaluate", async () => {
    const session = new FakeSession();
    const page = createPage(session);
    documentReady(session, 1, 2);

    // The wait is pending in the outgoing document's world when the navigation
    // that the caller is waiting for commits.
    session.answers.set(2, async () => {
      session.emit("Runtime.executionContextsCleared", {});
      documentReady(session, 3, 4);
      throw new Error("-32000 Inspected target navigated or closed");
    });
    session.answers.set(4, async () => ({ result: { value: true } }));

    await expect(page.waitForSelector("#query", { timeout: 1000 })).resolves.toBe(true);
    expect(session.evaluateCalls.map((call) => call.contextId)).toStrictEqual([2, 4]);
    // The retry carries the time left, not the original budget.
    const retryTimeout = Number(
      /\["waitForSelector"\]\("#query", "visible", (\d+), /.exec(
        session.evaluateCalls[1]!.expression,
      )?.[1],
    );
    expect(retryTimeout).toBeGreaterThan(0);
    expect(retryTimeout).toBeLessThanOrEqual(1000);
  });

  it("gives up once the budget is spent", async () => {
    const session = new FakeSession();
    const page = createPage(session);
    documentReady(session, 1, 2);
    session.answers.set(2, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      session.emit("Runtime.executionContextsCleared", {});
      documentReady(session, 3, 4);
      throw new Error("Execution context was destroyed.");
    });
    session.answers.set(4, async () => ({ result: { value: true } }));

    await expect(page.waitForSelector("#query", { timeout: 20 })).rejects.toThrow(
      "Execution context was destroyed",
    );
    expect(session.evaluateCalls).toHaveLength(1);
  });

  it("does not retry other evaluate failures", async () => {
    const session = new FakeSession();
    const page = createPage(session);
    documentReady(session, 1, 2);
    session.answers.set(2, async () => {
      throw new Error("Some other CDP error");
    });

    await expect(page.waitForSelector("#query", { timeout: 1000 })).rejects.toThrow(
      "Some other CDP error",
    );
    expect(session.evaluateCalls).toHaveLength(1);
  });
});

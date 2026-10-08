import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { executionContexts } from "../understudy/executionContextRegistry.js";
import { Page } from "../understudy/page.js";

type CDPCall = { method: string; params?: object };
type SendHandler = (method: string, params?: object) => unknown;

class EvaluationSession implements CDPSessionLike {
  private static nextId = 1;
  readonly id = `evaluation-session-${EvaluationSession.nextId++}`;
  readonly calls: CDPCall[] = [];

  constructor(private readonly handler: SendHandler) {}

  async send<Result = unknown>(method: string, params?: object): Promise<Result> {
    this.calls.push({ method, params });
    return (await this.handler(method, params)) as Result;
  }

  on(): void {}

  off(): void {}

  async close(): Promise<void> {}
}

function createPage(session: EvaluationSession): Page {
  executionContexts.register(session, "frame-a", 7);
  return new Page({} as CdpConnection, session, "page-a", "frame-a", {} as StagehandLogger);
}

function runtimeMethods(session: EvaluationSession): string[] {
  return session.calls
    .map(({ method }) => method)
    .filter((method) => method.startsWith("Runtime."));
}

describe("Page.evaluate", () => {
  it("retains a returned promise by object id while awaiting its value", async () => {
    const session = new EvaluationSession((method, params) => {
      if (method === "Runtime.enable") return {};
      if (method === "Runtime.evaluate") {
        expect(params).toMatchObject({
          contextId: 7,
          awaitPromise: false,
          returnByValue: false,
        });
        return {
          result: {
            type: "object",
            subtype: "promise",
            className: "Promise",
            description: "Promise",
            objectId: "promise-1",
          },
        } satisfies Protocol.Runtime.EvaluateResponse;
      }
      if (method === "Runtime.awaitPromise") {
        expect(params).toStrictEqual({
          promiseObjectId: "promise-1",
          returnByValue: true,
        });
        return {
          result: { type: "object", value: { answer: 42 } },
        } satisfies Protocol.Runtime.EvaluateResponse;
      }
      if (method === "Runtime.releaseObject") {
        expect(params).toStrictEqual({ objectId: "promise-1" });
        return {};
      }
      throw new Error(`Unexpected CDP method ${method}`);
    });

    await expect(createPage(session).evaluate("Promise.resolve({ answer: 42 })")).resolves.toEqual({
      answer: 42,
    });
    expect(runtimeMethods(session)).toStrictEqual([
      "Runtime.enable",
      "Runtime.evaluate",
      "Runtime.awaitPromise",
      "Runtime.releaseObject",
    ]);
  });

  it("serializes a synchronous object through its retained remote handle", async () => {
    const session = new EvaluationSession((method, params) => {
      if (method === "Runtime.enable") return {};
      if (method === "Runtime.evaluate") {
        return {
          result: {
            type: "object",
            className: "Object",
            description: "Object",
            objectId: "object-1",
          },
        } satisfies Protocol.Runtime.EvaluateResponse;
      }
      if (method === "Runtime.callFunctionOn") {
        expect(params).toStrictEqual({
          objectId: "object-1",
          functionDeclaration: "function() { return this; }",
          returnByValue: true,
        });
        return {
          result: { type: "object", value: { answer: 42 } },
        } satisfies Protocol.Runtime.EvaluateResponse;
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method ${method}`);
    });

    await expect(createPage(session).evaluate("({ answer: 42 })")).resolves.toEqual({
      answer: 42,
    });
    expect(runtimeMethods(session)).toStrictEqual([
      "Runtime.enable",
      "Runtime.evaluate",
      "Runtime.callFunctionOn",
      "Runtime.releaseObject",
    ]);
  });

  it("returns primitive results without creating a remote handle", async () => {
    const session = new EvaluationSession((method) => {
      if (method === "Runtime.enable") return {};
      if (method === "Runtime.evaluate") {
        return {
          result: { type: "number", value: 42 },
        } satisfies Protocol.Runtime.EvaluateResponse;
      }
      throw new Error(`Unexpected CDP method ${method}`);
    });

    await expect(createPage(session).evaluate("40 + 2")).resolves.toBe(42);
    expect(runtimeMethods(session)).toStrictEqual(["Runtime.enable", "Runtime.evaluate"]);
  });

  it("releases the retained object when promise materialization fails", async () => {
    const session = new EvaluationSession((method) => {
      if (method === "Runtime.enable") return {};
      if (method === "Runtime.evaluate") {
        return {
          result: {
            type: "object",
            subtype: "promise",
            className: "Promise",
            description: "Promise",
            objectId: "promise-1",
          },
        } satisfies Protocol.Runtime.EvaluateResponse;
      }
      if (method === "Runtime.awaitPromise") {
        throw new Error("await failed");
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method ${method}`);
    });

    await expect(createPage(session).evaluate("new Promise(() => {})")).rejects.toThrow(
      "await failed",
    );
    expect(session.calls.at(-1)).toStrictEqual({
      method: "Runtime.releaseObject",
      params: { objectId: "promise-1" },
    });
  });
});

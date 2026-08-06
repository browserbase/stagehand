import { describe, expect, it, vi } from "vitest";
import type { StagehandRpcRequest } from "../../protocol/types.js";
import { installCallbackBatchRunner } from "../callbackBatch.js";
import type { RPCRouter } from "../rpcRouter.js";

describe("callback batch runner", () => {
  it("runs the shared Page and Locator wrappers through the in-process router", async () => {
    const requests: StagehandRpcRequest[] = [];
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") {
          return [{ pageId: "page-1", url: "https://example.com" }];
        }
        if (request.method === "context.active_page") {
          return { pageId: "page-1", url: "https://example.com" };
        }
        if (request.method === "locator.click") return { clicked: true };
        if (request.method === "page.title") return "Example";
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const scope: Parameters<typeof installCallbackBatchRunner>[0] = {};
    installCallbackBatchRunner(scope, router);

    const result = await scope.__stagehandRunCallbackBatch?.(
      async ({ page }) => {
        await page.locator("button").click();
        return { title: await page.title() };
      },
      null,
      { timeout: 1_000 },
    );

    expect(result).toEqual({ ok: true, value: { title: "Example" } });
    expect(requests.map((request) => request.method)).toEqual([
      "context.pages",
      "context.active_page",
      "locator.click",
      "page.title",
    ]);
    expect(requests[2]?.params).toEqual({ pageId: "page-1", selector: "button" });
  });

  it("returns a distinct envelope for undefined", async () => {
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        if (request.method === "context.pages") return [{ pageId: "page-1" }];
        if (request.method === "context.active_page") return { pageId: "page-1" };
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const scope: Parameters<typeof installCallbackBatchRunner>[0] = {};
    installCallbackBatchRunner(scope, router);

    await expect(
      scope.__stagehandRunCallbackBatch?.(async () => undefined, null, { timeout: 1_000 }),
    ).resolves.toEqual({ ok: true, valueIsUndefined: true });
  });

  it("does not expose context lifecycle or internals to callbacks", async () => {
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        if (request.method === "context.pages") return [{ pageId: "page-1" }];
        if (request.method === "context.active_page") return { pageId: "page-1" };
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const scope: Parameters<typeof installCallbackBatchRunner>[0] = {};
    installCallbackBatchRunner(scope, router);

    const result = await scope.__stagehandRunCallbackBatch?.(
      async ({ context }) => {
        const pages = await context.pages();
        return {
          hasClose: "close" in context,
          close: (context as unknown as { close?: unknown }).close,
          prototype: Object.getPrototypeOf(context),
          constructor: (context as unknown as { constructor?: unknown }).constructor,
          rpcClient: (context as unknown as { rpcClient?: unknown }).rpcClient,
          clipboardRef: (context as unknown as { clipboardRef?: unknown }).clipboardRef,
          pageCount: pages.length,
        };
      },
      null,
      { timeout: 1_000 },
    );

    expect(result).toEqual({
      ok: true,
      value: { hasClose: false, prototype: null, pageCount: 1 },
    });
  });

  it("normalizes extract schema and options overloads", async () => {
    const requests: StagehandRpcRequest[] = [];
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") return [{ pageId: "page-1" }];
        if (request.method === "context.active_page") return { pageId: "page-1" };
        if (request.method === "stagehand.extract") {
          return {
            data: { extraction: "Example" },
            metadata: {
              cache: { status: "DISABLED" },
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                cachedInputTokens: 0,
                inferenceTimeMs: 0,
              },
            },
          };
        }
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const scope: Parameters<typeof installCallbackBatchRunner>[0] = {};
    installCallbackBatchRunner(scope, router);

    const result = await scope.__stagehandRunCallbackBatch?.(
      async (stagehand) => {
        await stagehand.extract("options only", { timeout: 1_000 });
        await stagehand.extract("schema only", { type: "object" });
        await stagehand.extract("schema and options", { type: "object" }, { timeout: 2_000 });
        await stagehand.extract("empty schema", {}, undefined);
        return true;
      },
      null,
      { timeout: 10_000 },
    );

    expect(result).toEqual({ ok: true, value: true });
    const extractParams = requests
      .filter((request) => request.method === "stagehand.extract")
      .map((request) => request.params as Record<string, unknown>);
    expect(extractParams[0]).toMatchObject({
      instruction: "options only",
      options: { timeout: 1_000 },
    });
    expect(extractParams[0]?.schema).not.toEqual({ timeout: 1_000 });
    expect(extractParams[1]).toMatchObject({
      instruction: "schema only",
      schema: { type: "object" },
    });
    expect(extractParams[2]).toMatchObject({
      instruction: "schema and options",
      schema: { type: "object" },
      options: { timeout: 2_000 },
    });
    expect(extractParams[3]).toMatchObject({
      instruction: "empty schema",
      schema: {},
    });
  });

  it("normalizes and strips per-operation page options", async () => {
    const requests: StagehandRpcRequest[] = [];
    const metadata = {
      cache: { status: "DISABLED" },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        inferenceTimeMs: 0,
      },
    };
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") {
          return [{ pageId: "page-1" }, { pageId: "page-2" }];
        }
        if (request.method === "context.active_page") return { pageId: "page-1" };
        if (request.method === "stagehand.act") {
          return {
            data: { success: true, message: "done", actionDescription: "done", actions: [] },
            metadata,
          };
        }
        if (request.method === "stagehand.observe") return { data: [], metadata };
        if (request.method === "stagehand.extract") {
          return { data: { extraction: "done" }, metadata };
        }
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const scope: Parameters<typeof installCallbackBatchRunner>[0] = {};
    installCallbackBatchRunner(scope, router);

    const result = await scope.__stagehandRunCallbackBatch?.(
      async (stagehand) => {
        const pages = await stagehand.context.pages();
        const operationPage = pages[1];
        if (!operationPage) throw new Error("missing second page");
        await stagehand.act("act", { page: operationPage, timeout: 1_000 });
        await stagehand.observe("observe", { page: operationPage, timeout: 2_000 });
        await stagehand.extract("extract", { page: operationPage, timeout: 3_000 });
        return true;
      },
      null,
      { timeout: 10_000 },
    );

    expect(result).toEqual({ ok: true, value: true });
    const operationRequests = requests.filter((request) => request.method.startsWith("stagehand."));
    expect(operationRequests.map((request) => request.params)).toEqual([
      { pageId: "page-2", instruction: "act", options: { timeout: 1_000 } },
      { pageId: "page-2", instruction: "observe", options: { timeout: 2_000 } },
      expect.objectContaining({
        pageId: "page-2",
        instruction: "extract",
        options: { timeout: 3_000 },
      }),
    ]);
  });
});

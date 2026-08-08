import { describe, expect, it, vi } from "vitest";
import type { CallbackBatchOptions, StagehandRpcRequest } from "../../protocol/types.js";
import { createCallbackBatchController, type CallbackBatchFunction } from "../callbackBatch.js";
import type { HandlerContext, RPCRouter } from "../rpcRouter.js";

const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
const zeroMetadata = {
  cache: { status: "DISABLED" },
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    inferenceTimeMs: 0,
  },
};

async function runCallbackBatch(
  router: RPCRouter,
  callback: CallbackBatchFunction,
  input: unknown,
  options: CallbackBatchOptions,
) {
  return await createCallbackBatchController(router).run(
    {
      callbackSource: Function.prototype.toString.call(callback),
      input: input as never,
      options,
    },
    {
      traceContext: { traceparent },
      runtimeAttachments: { callback },
    } as HandlerContext,
  );
}

describe("callback batch runner", () => {
  it("rejects a registered request without its runtime callback attachment", async () => {
    const router = {} as RPCRouter;
    await expect(
      createCallbackBatchController(router).run(
        {
          callbackSource: "async () => undefined",
          options: { timeout: 1_000 },
        },
        {} as HandlerContext,
      ),
    ).rejects.toThrow("runtime callback attachment");
  });

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
    const result = await runCallbackBatch(
      router,
      async ({ page }) => {
        await page.locator("button").click();
        return { title: await page.title() };
      },
      null,
      { timeout: 1_000 },
    );

    expect(result).toEqual({ value: { title: "Example" } });
    expect(requests.map((request) => request.method)).toEqual([
      "context.active_page",
      "locator.click",
      "page.title",
    ]);
    expect(requests[1]?.params).toEqual({ pageId: "page-1", selector: "button" });
    expect(requests.every((request) => request.traceparent === traceparent)).toBe(true);
  });

  it("resolves an explicitly selected page without querying the active page", async () => {
    const requests: StagehandRpcRequest[] = [];
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") {
          return [{ pageId: "page-1" }, { pageId: "page-2", title: "Selected" }];
        }
        if (request.method === "page.title") return "Selected";
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const result = await runCallbackBatch(
      router,
      async ({ page }) => ({ pageId: page.pageId, title: await page.title() }),
      null,
      { pageId: "page-2", timeout: 1_000 },
    );

    expect(result).toEqual({
      value: { pageId: "page-2", title: "Selected" },
    });
    expect(requests.map((request) => request.method)).toEqual(["context.pages", "page.title"]);
  });

  it("represents undefined by omitting the value", async () => {
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        if (request.method === "context.pages") return [{ pageId: "page-1" }];
        if (request.method === "context.active_page") return { pageId: "page-1" };
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    await expect(
      runCallbackBatch(router, async () => undefined, null, { timeout: 1_000 }),
    ).resolves.toEqual({});
  });

  it("enforces the callback timeout in the worker", async () => {
    vi.useFakeTimers();
    try {
      const router = {
        handle: vi.fn(async (request: StagehandRpcRequest) => {
          if (request.method === "context.active_page") return { pageId: "page-1" };
          throw new Error(`Unexpected method: ${request.method}`);
        }),
      } as unknown as RPCRouter;
      const pending = runCallbackBatch(
        router,
        async () => await new Promise<never>(() => {}),
        null,
        { timeout: 25 },
      );
      const rejected = expect(pending).rejects.toThrow(
        "Stagehand callback batch timed out after 25ms",
      );

      await vi.advanceTimersByTimeAsync(25);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows independent callback batches to run concurrently", async () => {
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        if (request.method === "context.active_page") return { pageId: "page-1" };
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const controller = createCallbackBatchController(router);
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const first = controller.run(
      { callbackSource: "async () => 'first'", options: { timeout: 1_000 } },
      {
        runtimeAttachments: {
          callback: async () => {
            markFirstStarted?.();
            await firstGate;
            return "first";
          },
        },
      } as HandlerContext,
    );
    await firstStarted;

    await expect(
      controller.run({ callbackSource: "async () => 'second'", options: { timeout: 1_000 } }, {
        runtimeAttachments: { callback: async () => "second" },
      } as HandlerContext),
    ).resolves.toEqual({ value: "second" });
    releaseFirst?.();
    await expect(first).resolves.toEqual({ value: "first" });
  });

  it("does not expose context lifecycle or internals to callbacks", async () => {
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        if (request.method === "context.pages") return [{ pageId: "page-1" }];
        if (request.method === "context.active_page") return { pageId: "page-1" };
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const result = await runCallbackBatch(
      router,
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
      value: { hasClose: false, prototype: null, pageCount: 1 },
    });
  });

  it("resolves the active page when each default operation runs", async () => {
    const requests: StagehandRpcRequest[] = [];
    let activePageId = "page-1";
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") {
          return [{ pageId: "page-1" }, { pageId: "page-2" }];
        }
        if (request.method === "context.active_page") return { pageId: activePageId };
        if (request.method === "context.set_active_page") {
          activePageId = (request.params as { pageId: string }).pageId;
          return { ok: true };
        }
        if (request.method === "stagehand.act") {
          return {
            data: { success: true, message: "done", actionDescription: "done", actions: [] },
            metadata: zeroMetadata,
          };
        }
        if (request.method === "stagehand.observe") return { data: [], metadata: zeroMetadata };
        if (request.method === "stagehand.extract") {
          return { data: { extraction: "done" }, metadata: zeroMetadata };
        }
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;

    await runCallbackBatch(
      router,
      async (stagehand) => {
        const pages = await stagehand.context.pages();
        const nextPage = pages[1];
        if (!nextPage) throw new Error("missing second page");
        await stagehand.context.setActivePage(nextPage);
        await stagehand.act("act");
        await stagehand.observe("observe");
        await stagehand.extract("extract");
      },
      null,
      { timeout: 10_000 },
    );

    const operationRequests = requests.filter((request) => request.method.startsWith("stagehand."));
    expect(
      operationRequests.map((request) => (request.params as { pageId: string }).pageId),
    ).toEqual(["page-2", "page-2", "page-2"]);
  });

  it("keeps AI operation defaults on the active page when the batch selects a page", async () => {
    const requests: StagehandRpcRequest[] = [];
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") {
          return [{ pageId: "page-1" }, { pageId: "page-2" }];
        }
        if (request.method === "context.active_page") return { pageId: "page-2" };
        if (request.method === "stagehand.act") {
          return {
            data: { success: true, message: "done", actionDescription: "done", actions: [] },
            metadata: zeroMetadata,
          };
        }
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;

    const result = await runCallbackBatch(
      router,
      async (stagehand) => {
        await stagehand.act("act");
        return stagehand.page.pageId;
      },
      null,
      { pageId: "page-1", timeout: 10_000 },
    );

    expect(result).toEqual({ value: "page-1" });
    const actRequest = requests.find((request) => request.method === "stagehand.act");
    expect((actRequest?.params as { pageId: string } | undefined)?.pageId).toBe("page-2");
    expect(requests.filter((request) => request.method === "context.active_page")).toHaveLength(1);
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
    const result = await runCallbackBatch(
      router,
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

    expect(result).toEqual({ value: true });
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
            metadata: zeroMetadata,
          };
        }
        if (request.method === "stagehand.observe") return { data: [], metadata: zeroMetadata };
        if (request.method === "stagehand.extract") {
          return { data: { extraction: "done" }, metadata: zeroMetadata };
        }
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    const result = await runCallbackBatch(
      router,
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

    expect(result).toEqual({ value: true });
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

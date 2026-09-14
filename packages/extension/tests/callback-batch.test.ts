import { describe, expect, it, vi } from "vitest";
import type {
  CallbackBatchOptions,
  StagehandRpcRequest,
} from "@browserbasehq/stagehand-protocol/types";
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

  it("rejects operations started after the callback completes", async () => {
    const requests: StagehandRpcRequest[] = [];
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.active_page") return { pageId: "page-1" };
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;
    let capturedBatch: Parameters<CallbackBatchFunction>[0] | undefined;

    await runCallbackBatch(
      router,
      async (batch) => {
        capturedBatch = batch;
        return "done";
      },
      null,
      { timeout: 1_000 },
    );

    if (!capturedBatch) throw new Error("missing captured batch context");
    await expect(capturedBatch.page.title()).rejects.toThrow(
      "Stagehand callback batch has completed",
    );
    expect(requests.map((request) => request.method)).toEqual(["context.active_page"]);
  });

  it("enforces the callback timeout in the worker", async () => {
    vi.useFakeTimers();
    try {
      const requests: StagehandRpcRequest[] = [];
      const router = {
        handle: vi.fn(async (request: StagehandRpcRequest) => {
          requests.push(request);
          if (request.method === "context.active_page") return { pageId: "page-1" };
          throw new Error(`Unexpected method: ${request.method}`);
        }),
      } as unknown as RPCRouter;
      let releaseCallback: () => void = () => {};
      const callbackGate = new Promise<void>((resolve) => {
        releaseCallback = resolve;
      });
      let recordLateOperationError: (error: unknown) => void = () => {};
      const lateOperationError = new Promise<unknown>((resolve) => {
        recordLateOperationError = resolve;
      });
      const pending = runCallbackBatch(
        router,
        async (batch) => {
          await callbackGate;
          try {
            await batch.act("click Continue", { page: batch.page });
            recordLateOperationError(undefined);
          } catch (error) {
            recordLateOperationError(error);
          }
        },
        null,
        { timeout: 25 },
      );
      const rejected = expect(pending).rejects.toThrow(
        "Stagehand callback batch timed out after 25ms",
      );

      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      releaseCallback();

      const lateError = await lateOperationError;
      expect(lateError).toBeInstanceOf(Error);
      expect((lateError as Error).message).toBe("Stagehand callback batch timed out after 25ms");
      expect(requests.map((request) => request.method)).toEqual(["context.active_page"]);
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
        await stagehand.act("act", {
          page: operationPage,
          locator: operationPage.locator("main"),
          ignoreLocators: [operationPage.locator("nav")],
          timeout: 1_000,
        });
        await stagehand.observe("observe", {
          page: operationPage,
          locator: operationPage.locator("section"),
          timeout: 2_000,
        });
        await stagehand.extract("extract", {
          page: operationPage,
          ignoreLocators: [operationPage.locator(".ad")],
          timeout: 3_000,
        });
        return true;
      },
      null,
      { timeout: 10_000 },
    );

    expect(result).toEqual({ value: true });
    const operationRequests = requests.filter((request) => request.method.startsWith("stagehand."));
    expect(operationRequests.map((request) => request.params)).toEqual([
      {
        pageId: "page-2",
        instruction: "act",
        options: {
          locator: { selector: "main" },
          ignoreLocators: [{ selector: "nav" }],
          timeout: 1_000,
        },
      },
      {
        pageId: "page-2",
        instruction: "observe",
        options: { locator: { selector: "section" }, timeout: 2_000 },
      },
      expect.objectContaining({
        pageId: "page-2",
        instruction: "extract",
        options: { ignoreLocators: [{ selector: ".ad" }], timeout: 3_000 },
      }),
    ]);
  });

  it("serializes observe and extract locators inside callback batches", async () => {
    const requests: StagehandRpcRequest[] = [];
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") {
          return [{ pageId: "page-1" }, { pageId: "page-2" }];
        }
        if (request.method === "context.active_page") return { pageId: "page-1" };
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
        const operationPage = pages[1];
        if (!operationPage) throw new Error("missing second page");

        await stagehand.observe("observe", {
          page: operationPage,
          locator: operationPage.locator("main").nth(2),
          ignoreLocators: [operationPage.locator("nav").nth(1)],
        });
        await stagehand.extract("extract", {
          page: operationPage,
          locator: operationPage.locator("section.content").nth(3),
          ignoreLocators: [operationPage.locator("aside.ads").nth(0)],
        });
      },
      null,
      { timeout: 10_000 },
    );

    const operationRequests = requests.filter((request) => request.method.startsWith("stagehand."));
    expect(operationRequests.map((request) => request.params)).toEqual([
      {
        pageId: "page-2",
        instruction: "observe",
        options: {
          locator: { selector: "main", nth: 2 },
          ignoreLocators: [{ selector: "nav", nth: 1 }],
        },
      },
      expect.objectContaining({
        pageId: "page-2",
        instruction: "extract",
        options: {
          locator: { selector: "section.content", nth: 3 },
          ignoreLocators: [{ selector: "aside.ads", nth: 0 }],
        },
      }),
    ]);
  });

  it("rejects callback-batch observe and extract locators from another page", async () => {
    const requests: StagehandRpcRequest[] = [];
    const router = {
      handle: vi.fn(async (request: StagehandRpcRequest) => {
        requests.push(request);
        if (request.method === "context.pages") {
          return [{ pageId: "page-1" }, { pageId: "page-2" }];
        }
        if (request.method === "context.active_page") return { pageId: "page-1" };
        if (request.method === "stagehand.observe") return { data: [], metadata: zeroMetadata };
        if (request.method === "stagehand.extract") {
          return { data: { extraction: "done" }, metadata: zeroMetadata };
        }
        throw new Error(`Unexpected method: ${request.method}`);
      }),
    } as unknown as RPCRouter;

    await expect(
      runCallbackBatch(
        router,
        async (stagehand) => {
          const pages = await stagehand.context.pages();
          const operationPage = pages[0];
          const otherPage = pages[1];
          if (!operationPage || !otherPage) throw new Error("missing pages");

          await stagehand.observe("observe", {
            page: operationPage,
            locator: otherPage.locator("main"),
          });
        },
        null,
        { timeout: 10_000 },
      ),
    ).rejects.toThrow("observe(): locator must belong to the target page");

    await expect(
      runCallbackBatch(
        router,
        async (stagehand) => {
          const pages = await stagehand.context.pages();
          const operationPage = pages[0];
          const otherPage = pages[1];
          if (!operationPage || !otherPage) throw new Error("missing pages");

          await stagehand.extract("extract", {
            page: operationPage,
            ignoreLocators: [otherPage.locator("nav")],
          });
        },
        null,
        { timeout: 10_000 },
      ),
    ).rejects.toThrow("extract(): locator must belong to the target page");

    expect(requests.filter((request) => request.method.startsWith("stagehand."))).toHaveLength(0);
  });
});

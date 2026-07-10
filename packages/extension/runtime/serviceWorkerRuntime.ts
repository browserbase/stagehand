import { z } from "zod/v4";
import {
  JSONRPCErrorResponseSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  JSONRPCSuccessResponseSchema,
} from "../../protocol/json-rpc/schemas.js";
import { encodeWireValue } from "../../protocol/json-rpc/wire-casing.js";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";

type StagehandRuntimeResponse = z.output<typeof JSONRPCResponseSchema>;
type PageGotoParams = z.output<(typeof StagehandMethods)["page.goto"]["paramsSchema"]>;
type PageGotoResult = z.output<(typeof StagehandMethods)["page.goto"]["resultSchema"]>;

type ChromeTab = {
  id?: number;
  url?: string;
  title?: string;
  status?: string;
};

type ChromeApi = {
  runtime: {
    lastError?: {
      message?: string;
    };
    onInstalled?: {
      addListener(listener: () => void): void;
    };
    onStartup?: {
      addListener(listener: () => void): void;
    };
    onMessage?: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse?: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  tabs: {
    get(tabId: number, callback: (tab: ChromeTab) => void): void;
    query(queryInfo: Record<string, unknown>, callback: (tabs: ChromeTab[]) => void): void;
    update(
      tabId: number,
      updateProperties: { url: string },
      callback: (tab: ChromeTab) => void,
    ): void;
    onUpdated: {
      addListener(
        listener: (tabId: number, changeInfo: { status?: string }, tab: ChromeTab) => void,
      ): void;
      removeListener(
        listener: (tabId: number, changeInfo: { status?: string }, tab: ChromeTab) => void,
      ): void;
    };
  };
};

type StagehandRPCGlobal = typeof globalThis & {
  StagehandRPC?: {
    handle(raw: unknown): Promise<StagehandRuntimeResponse>;
  };
  chrome?: ChromeApi;
};

const runtimeGlobal = globalThis as StagehandRPCGlobal;

export function installStagehandRPC(scope: StagehandRPCGlobal = runtimeGlobal): void {
  scope.StagehandRPC = {
    handle: handleStagehandRPCRequest,
  };
}

export async function handleStagehandRPCRequest(raw: unknown): Promise<StagehandRuntimeResponse> {
  let input: unknown;

  try {
    input = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return rpcError(null, -32700, "Parse error", "stagehand.parse_error");
  }

  const envelopeResult = JSONRPCRequestSchema.safeParse(input);

  if (!envelopeResult.success) {
    return rpcError(
      requestIdFromInput(input),
      -32600,
      "Invalid request",
      "stagehand.invalid_request",
    );
  }

  const envelope = envelopeResult.data;

  if (envelope.id === undefined) {
    return rpcError(null, -32600, "Invalid request", "stagehand.invalid_request");
  }

  const requestResult = StagehandRpcRequestSchema.safeParse(input);

  if (!requestResult.success) {
    return Object.hasOwn(StagehandMethods, envelope.method)
      ? rpcError(envelope.id, -32602, "Invalid params", "stagehand.invalid_params")
      : rpcError(envelope.id, -32601, "Method not found", "stagehand.unknown_command");
  }

  const request = requestResult.data;

  try {
    switch (request.method) {
      case "ping":
        return rpcSuccess(
          request.id,
          encodeWireValue(
            StagehandMethods.ping.resultSchema.parse({
              ok: true,
              runtime: "service_worker",
            }),
          ),
        );
      case "page.goto":
        return rpcSuccess(
          request.id,
          encodeWireValue(
            StagehandMethods["page.goto"].resultSchema.parse(await gotoActivePage(request.params)),
          ),
        );
      default:
        return rpcError(
          request.id,
          -32601,
          "Method not implemented by the smoke runtime",
          "stagehand.unknown_command",
        );
    }
  } catch {
    return rpcError(request.id, -32603, "Internal error", "stagehand.internal_error");
  }
}

installStagehandRPC();
runtimeGlobal.chrome?.runtime.onInstalled?.addListener(() => {});
runtimeGlobal.chrome?.runtime.onStartup?.addListener(() => {});
runtimeGlobal.chrome?.runtime.onMessage?.addListener((_message, _sender, sendResponse) => {
  sendResponse?.({ ok: true });
  return false;
});

async function gotoActivePage(params: PageGotoParams): Promise<PageGotoResult> {
  const chromeApi = getChromeApi();
  const timeoutMs = params.options?.timeoutMs ?? 10_000;
  const tab = await getActiveTab(chromeApi);
  const tabId = requireTabId(tab);

  await callChrome<ChromeTab>((callback) => {
    chromeApi.tabs.update(tabId, { url: params.url }, callback);
  });
  await waitForTabLoad(chromeApi, tabId, timeoutMs);

  const currentTab = await callChrome<ChromeTab>((callback) => {
    chromeApi.tabs.get(tabId, callback);
  });

  return {
    pageId: params.pageId,
    url: currentTab.url ?? params.url,
    ...(currentTab.title === undefined ? {} : { title: currentTab.title }),
  };
}

async function getActiveTab(chromeApi: ChromeApi): Promise<ChromeTab> {
  const activeTabs = await callChrome<ChromeTab[]>((callback) => {
    chromeApi.tabs.query({ active: true, lastFocusedWindow: true }, callback);
  });

  if (activeTabs[0]) {
    return activeTabs[0];
  }

  const anyTabs = await callChrome<ChromeTab[]>((callback) => {
    chromeApi.tabs.query({}, callback);
  });

  if (!anyTabs[0]) {
    throw new Error("No browser tabs are available");
  }

  return anyTabs[0];
}

async function waitForTabLoad(
  chromeApi: ChromeApi,
  tabId: number,
  timeoutMs: number,
): Promise<void> {
  const currentTab = await callChrome<ChromeTab>((callback) => {
    chromeApi.tabs.get(tabId, callback);
  });

  if (currentTab.status === "complete") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chromeApi.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for tab ${tabId} to load`));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }): void => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeout);
      chromeApi.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chromeApi.tabs.onUpdated.addListener(listener);
  });
}

function rpcSuccess(
  id: string | number,
  result: z.input<typeof JSONRPCSuccessResponseSchema>["result"],
): StagehandRuntimeResponse {
  return JSONRPCSuccessResponseSchema.parse({ jsonrpc: "2.0", id, result });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  type: string,
): StagehandRuntimeResponse {
  return JSONRPCErrorResponseSchema.parse({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data: { type },
    },
  });
}

function requestIdFromInput(input: unknown): string | number | null {
  if (!isRecord(input)) return null;
  return typeof input.id === "string" || typeof input.id === "number" ? input.id : null;
}

function callChrome<Result>(
  operation: (callback: (result: Result) => void) => void,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    operation((result) => {
      const lastError = runtimeGlobal.chrome?.runtime.lastError;

      if (lastError) {
        reject(new Error(lastError.message ?? "Chrome extension API failed"));
        return;
      }

      resolve(result);
    });
  });
}

function getChromeApi(): ChromeApi {
  if (!runtimeGlobal.chrome) {
    throw new Error("Chrome extension API is unavailable");
  }

  return runtimeGlobal.chrome;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireTabId(tab: ChromeTab): number {
  if (typeof tab.id !== "number") {
    throw new Error("Active browser tab is missing a tab id");
  }

  return tab.id;
}

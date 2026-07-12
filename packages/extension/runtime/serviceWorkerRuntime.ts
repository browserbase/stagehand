import { z } from "zod/v4";
import {
  JSONRPCErrorResponseSchema,
  JSONRPCRequestIdSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  JSONRPCSuccessResponseSchema,
} from "../../protocol/json-rpc/schemas.js";
import { encodeWireValue } from "../../protocol/json-rpc/wire-casing.js";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";

type StagehandRuntimeResponse = z.output<typeof JSONRPCResponseSchema>;
type PageGotoParams = z.output<(typeof StagehandMethods)["page.goto"]["paramsSchema"]>;
type PageGotoResult = z.output<(typeof StagehandMethods)["page.goto"]["resultSchema"]>;
type RuntimeConfigureParams = z.output<
  (typeof StagehandMethods)["runtime.configure"]["paramsSchema"]
>;
type BrowserGetVersionResult = z.output<
  (typeof StagehandMethods)["browser.get_version"]["resultSchema"]
>;

type JsonObject = Record<string, unknown>;

type CdpResponse<Result> = {
  id: number;
  result?: Result;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type PendingCdpRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export type LoopbackCdpConnection = {
  readonly connected: boolean;
  send<Result = JsonObject>(method: string, params?: JsonObject): Promise<Result>;
  close(): void;
};

export type LoopbackCdpConnectionFactory = (cdpUrl: string) => Promise<LoopbackCdpConnection>;

export type StagehandRuntimeDependencies = {
  loopbackCdpFactory?: LoopbackCdpConnectionFactory;
};

type StagehandRuntimeState = {
  loopback?: LoopbackCdpConnection;
};

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

type StagehandRPCInstallScope = {
  __stagehand_runtime?: {
    name: "stagehand";
    version: "stagehand.v4";
  };
  StagehandRPC?: {
    handle(raw: unknown): Promise<StagehandRuntimeResponse>;
  };
};

type StagehandRPCGlobal = typeof globalThis &
  StagehandRPCInstallScope & {
    chrome?: ChromeApi;
  };

const runtimeGlobal = globalThis as StagehandRPCGlobal;
const defaultRuntimeState: StagehandRuntimeState = {};
const defaultLoopbackCdpFactory: LoopbackCdpConnectionFactory = (cdpUrl) =>
  BrowserLoopbackCdpConnection.connect(cdpUrl);

export function installStagehandRPC(scope: StagehandRPCInstallScope = runtimeGlobal): void {
  scope.__stagehand_runtime = {
    name: "stagehand",
    version: "stagehand.v4",
  };
  scope.StagehandRPC = {
    handle: handleStagehandRPCRequest,
  };
}

export async function handleStagehandRPCRequest(raw: unknown): Promise<StagehandRuntimeResponse> {
  return handleStagehandRPCRequestWithState(raw, defaultRuntimeState, {
    loopbackCdpFactory: defaultLoopbackCdpFactory,
  });
}

export function createStagehandRPCHandler(
  dependencies: StagehandRuntimeDependencies = {},
): (raw: unknown) => Promise<StagehandRuntimeResponse> {
  const state: StagehandRuntimeState = {};
  return (raw) =>
    handleStagehandRPCRequestWithState(raw, state, {
      loopbackCdpFactory: dependencies.loopbackCdpFactory ?? defaultLoopbackCdpFactory,
    });
}

async function handleStagehandRPCRequestWithState(
  raw: unknown,
  state: StagehandRuntimeState,
  dependencies: Required<StagehandRuntimeDependencies>,
): Promise<StagehandRuntimeResponse> {
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
      case "runtime.configure":
        return rpcSuccess(
          request.id,
          encodeWireValue(
            StagehandMethods["runtime.configure"].resultSchema.parse(
              await configureLoopback(request.params, state, dependencies),
            ),
          ),
        );
      case "runtime.loopback_status":
        return rpcSuccess(
          request.id,
          encodeWireValue(
            StagehandMethods["runtime.loopback_status"].resultSchema.parse({
              configured: state.loopback !== undefined,
              connected: state.loopback?.connected ?? false,
            }),
          ),
        );
      case "browser.get_version":
        return rpcSuccess(
          request.id,
          encodeWireValue(
            StagehandMethods["browser.get_version"].resultSchema.parse(
              await requireLoopback(state).send<BrowserGetVersionResult>("Browser.getVersion"),
            ),
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
  } catch (error) {
    if (error instanceof StagehandRuntimeError) {
      return rpcError(request.id, error.code, error.message, error.type);
    }

    return rpcError(request.id, -32603, "Internal error", "stagehand.internal_error");
  }
}

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

async function configureLoopback(
  params: RuntimeConfigureParams,
  state: StagehandRuntimeState,
  dependencies: Required<StagehandRuntimeDependencies>,
): Promise<{ configured: true }> {
  const previousLoopback = state.loopback;
  state.loopback = undefined;
  previousLoopback?.close();

  try {
    state.loopback = await dependencies.loopbackCdpFactory(params.cdpUrl);
  } catch (error) {
    throw new StagehandRuntimeError(
      `Failed to configure Stagehand loopback CDP: ${errorMessage(error)}`,
      -32002,
      "stagehand.loopback_configure_failed",
    );
  }

  return { configured: true };
}

function requireLoopback(state: StagehandRuntimeState): LoopbackCdpConnection {
  if (!state.loopback) {
    throw new StagehandRuntimeError(
      "Stagehand loopback CDP is not configured",
      -32000,
      "stagehand.loopback_not_configured",
    );
  }

  if (!state.loopback.connected) {
    throw new StagehandRuntimeError(
      "Stagehand loopback CDP is disconnected",
      -32001,
      "stagehand.loopback_disconnected",
    );
  }

  return state.loopback;
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
  id: number,
  result: z.input<typeof JSONRPCSuccessResponseSchema>["result"],
): StagehandRuntimeResponse {
  return JSONRPCSuccessResponseSchema.parse({ jsonrpc: "2.0", id, result });
}

function rpcError(
  id: number | null,
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

class StagehandRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly type: string,
  ) {
    super(message);
    this.name = "StagehandRuntimeError";
  }
}

class BrowserLoopbackCdpConnection implements LoopbackCdpConnection {
  #nextId = 1;
  #pending = new Map<number, PendingCdpRequest>();

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(event.data).catch((error: unknown) => {
        for (const pending of this.#pending.values()) {
          pending.reject(
            error instanceof Error ? error : new Error("Failed to handle loopback CDP message"),
          );
        }
        this.#pending.clear();
      });
    });

    this.socket.addEventListener("close", () => {
      this.rejectPending("Loopback CDP websocket closed");
    });

    this.socket.addEventListener("error", () => {
      this.rejectPending("Loopback CDP websocket error");
    });
  }

  get connected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  static async connect(cdpUrl: string): Promise<BrowserLoopbackCdpConnection> {
    const socket = new WebSocket(cdpUrl);

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Loopback CDP websocket failed to open")),
        { once: true },
      );
    });

    return new BrowserLoopbackCdpConnection(socket);
  }

  async send<Result = JsonObject>(method: string, params: JsonObject = {}): Promise<Result> {
    if (!this.connected) {
      throw new StagehandRuntimeError(
        "Stagehand loopback CDP is disconnected",
        -32001,
        "stagehand.loopback_disconnected",
      );
    }

    const id = this.#nextId++;
    const message = { id, method, params };

    const response = await new Promise<Result>((resolve, reject) => {
      this.#pending.set(id, {
        method,
        resolve: (value) => resolve(value as Result),
        reject,
      });

      this.socket.send(JSON.stringify(message));
    });

    return response;
  }

  close(): void {
    this.socket.close();
  }

  private async handleMessage(data: unknown): Promise<void> {
    const text = await messageDataToString(data);
    const message = JSON.parse(text) as Partial<CdpResponse<unknown>>;

    if (typeof message.id !== "number") {
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) {
      return;
    }

    this.#pending.delete(message.id);

    if (message.error) {
      pending.reject(
        new StagehandRuntimeError(
          message.error.message,
          message.error.code,
          "stagehand.loopback_cdp_error",
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private rejectPending(message: string): void {
    for (const pending of this.#pending.values()) {
      pending.reject(new StagehandRuntimeError(message, -32001, "stagehand.loopback_disconnected"));
    }
    this.#pending.clear();
  }
}

function requestIdFromInput(input: unknown): number | null {
  if (!isRecord(input)) return null;
  const result = JSONRPCRequestIdSchema.safeParse(input.id);
  return result.success ? result.data : null;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function messageDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (data instanceof Blob) {
    return data.text();
  }

  const view = data as ArrayBufferView;
  return new TextDecoder().decode(view);
}

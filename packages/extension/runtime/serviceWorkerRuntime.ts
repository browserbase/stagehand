type StagehandRuntimeRequest = {
  id?: string;
  command?: string;
  params?: unknown;
};

type StagehandRuntimeResponse =
  | {
      ok: true;
      id?: string;
      command: "ping" | "page.goto" | "page.click";
      result: unknown;
    }
  | {
      ok: false;
      id?: string;
      command?: string;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
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
  scripting: {
    executeScript(
      injection: {
        target: { tabId: number };
        func: (locator: unknown) => unknown;
        args: unknown[];
      },
      callback: (results: Array<{ result?: unknown }>) => void,
    ): void;
  };
};

type StagehandRPCGlobal = typeof globalThis & {
  StagehandRPC?: {
    handle(raw: string | StagehandRuntimeRequest): Promise<StagehandRuntimeResponse>;
  };
  chrome?: ChromeApi;
};

const runtimeGlobal = globalThis as StagehandRPCGlobal;

export function installStagehandRPC(scope: StagehandRPCGlobal = runtimeGlobal): void {
  scope.StagehandRPC = {
    handle: handleStagehandRPCRequest,
  };
}

export async function handleStagehandRPCRequest(
  raw: string | StagehandRuntimeRequest,
): Promise<StagehandRuntimeResponse> {
  const request = parseRuntimeRequest(raw);

  try {
    switch (request.command) {
      case "ping":
        return {
          ok: true,
          id: request.id,
          command: "ping",
          result: { ok: true, runtime: "service_worker" },
        };
      case "page.goto":
        return {
          ok: true,
          id: request.id,
          command: "page.goto",
          result: await gotoActivePage(request.params),
        };
      case "page.click":
        return {
          ok: true,
          id: request.id,
          command: "page.click",
          result: await clickActivePage(request.params),
        };
      default:
        return runtimeError(request, {
          code: "stagehand.unknown_command",
          message: `Unknown Stagehand command: ${String(request.command)}`,
        });
    }
  } catch (error) {
    return runtimeError(request, {
      code: "stagehand.runtime_error",
      message: error instanceof Error ? error.message : "Stagehand command failed",
    });
  }
}

installStagehandRPC();
runtimeGlobal.chrome?.runtime.onInstalled?.addListener(() => {});
runtimeGlobal.chrome?.runtime.onStartup?.addListener(() => {});
runtimeGlobal.chrome?.runtime.onMessage?.addListener((_message, _sender, sendResponse) => {
  sendResponse?.({ ok: true });
  return false;
});

function parseRuntimeRequest(raw: string | StagehandRuntimeRequest): StagehandRuntimeRequest {
  if (typeof raw === "string") {
    return JSON.parse(raw) as StagehandRuntimeRequest;
  }

  return raw;
}

async function gotoActivePage(params: unknown): Promise<{
  url: string;
  title: string | null;
}> {
  const chromeApi = getChromeApi();
  const options = requireRecord(params, "page.goto params");
  const url = requireString(options.url, "page.goto url");
  const timeoutMs = optionalPositiveInteger(options.timeout_ms) ?? 10_000;
  const tab = await getActiveTab(chromeApi);
  const tabId = requireTabId(tab);

  await callChrome<ChromeTab>((callback) => {
    chromeApi.tabs.update(tabId, { url }, callback);
  });
  await waitForTabLoad(chromeApi, tabId, timeoutMs);

  const currentTab = await callChrome<ChromeTab>((callback) => {
    chromeApi.tabs.get(tabId, callback);
  });

  return {
    url: currentTab.url ?? url,
    title: currentTab.title ?? null,
  };
}

async function clickActivePage(params: unknown): Promise<{
  clicked: true;
  tag_name?: string | null;
  text?: string | null;
}> {
  const chromeApi = getChromeApi();
  const options = requireRecord(params, "page.click params");
  const locator = requireRecord(options.locator, "page.click locator");

  if ("backendNodeId" in locator || "backend_node_id" in locator) {
    throw new Error("Public locators cannot include backend node ids");
  }

  const tab = await getActiveTab(chromeApi);
  const tabId = requireTabId(tab);
  const results = await callChrome<Array<{ result?: unknown }>>((callback) => {
    chromeApi.scripting.executeScript(
      {
        target: { tabId },
        func: clickLocatorInPage,
        args: [locator],
      },
      callback,
    );
  });
  const firstResult = results.at(0)?.result;

  if (!isRecord(firstResult) || firstResult.clicked !== true) {
    throw new Error("Click did not return a successful browser result");
  }

  return {
    clicked: true,
    tag_name: typeof firstResult.tag_name === "string" ? firstResult.tag_name : null,
    text: typeof firstResult.text === "string" ? firstResult.text : null,
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

function clickLocatorInPage(locator: unknown): {
  clicked: true;
  tag_name: string | null;
  text: string | null;
} {
  const input = locator as {
    css?: string;
    text?: string;
    coordinates?: { x?: number; y?: number };
  };
  let element: Element | null = null;

  if (input.css) {
    element = document.querySelector(input.css);
  }

  if (!element && input.text) {
    const candidates = Array.from(document.querySelectorAll("*"));
    element =
      candidates.find((candidate) => candidate.textContent?.trim().includes(input.text ?? "")) ??
      null;
  }

  if (!element && input.coordinates) {
    const { x, y } = input.coordinates;
    if (typeof x === "number" && typeof y === "number") {
      element = document.elementFromPoint(x, y);
    }
  }

  if (!(element instanceof HTMLElement)) {
    throw new Error("Could not resolve locator to a clickable element");
  }

  element.click();

  return {
    clicked: true,
    tag_name: element.tagName.toLowerCase(),
    text: element.textContent?.trim() ?? null,
  };
}

function runtimeError(
  request: StagehandRuntimeRequest,
  error: { code: string; message: string; details?: unknown },
): StagehandRuntimeResponse {
  return {
    ok: false,
    id: request.id,
    command: request.command,
    error,
  };
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error("timeout_ms must be a positive integer");
  }

  return Number(value);
}

function requireTabId(tab: ChromeTab): number {
  if (typeof tab.id !== "number") {
    throw new Error("Active browser tab is missing a tab id");
  }

  return tab.id;
}

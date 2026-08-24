import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.ts";
import { STAGEHAND_SEND_TO_HOST_BINDING } from "../../protocol/schema-registry.ts";
import type { StagehandBrowserSession } from "../runtime.ts";
import {
  startStagehandServiceWorker,
  type StagehandServiceWorkerScope,
} from "../service-worker.ts";
import { BrowserContext } from "../understudy/context.ts";

vi.mock("../understudy/context.ts", () => ({
  BrowserContext: { create: vi.fn() },
}));

// oxlint-disable-next-line typescript/unbound-method
const createBrowserContext = vi.mocked(BrowserContext.create);

function fakeSession(): StagehandBrowserSession {
  return {
    connected: true,
    prepareForInitialization: async () => {},
    pages: () => [],
    newPage: async () => {
      throw new Error("not used");
    },
    activePage: async () => undefined,
    setActivePage: async () => {},
    addInitScript: async () => {},
    setExtraHTTPHeaders: async () => {},
    getDomainPolicy: () => null,
    setDomainPolicy: async () => {},
    cookies: async () => [],
    addCookies: async () => {},
    clearCookies: async () => {},
    clipboard: {
      readText: async () => "",
      writeText: async () => {},
      clear: async () => {},
      paste: async () => {},
      copy: async () => {},
      cut: async () => {},
    },
    close: async () => {},
  };
}

function scope(messages: unknown[]): StagehandServiceWorkerScope & {
  [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
} {
  return {
    [STAGEHAND_SEND_TO_HOST_BINDING]: (payload) => messages.push(JSON.parse(payload)),
  };
}

function initRequest(browserCdpUrl?: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "stagehand.init",
    params: {
      protocol_version: STAGEHAND_PROTOCOL_VERSION,
      client_info: { name: "stagehand-sdk-test", version: "1.0.0" },
      ...(browserCdpUrl ? { browser_cdp_url: browserCdpUrl } : {}),
    },
  });
}

describe("resident service worker browser options", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "locator" })),
    );
    createBrowserContext.mockImplementation(async (_url, options) => {
      options.onConnected?.();
      return fakeSession() as never;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses restricted deferred instrumentation for a resident connection", async () => {
    const messages: unknown[] = [];
    const workerScope = scope(messages);
    startStagehandServiceWorker(workerScope, undefined, {
      resolveResidentWebSocketUrl: async () => "ws://resident.test/session",
    });

    await workerScope.__stagehandReceiveFromHost?.(initRequest());

    expect(createBrowserContext).toHaveBeenCalledOnce();
    const [url, options] = createBrowserContext.mock.calls[0]!;
    expect(url).toBe("ws://resident.test/session");
    expect(options).toMatchObject({
      restrictToWebTargets: true,
      deferPageInstrumentation: true,
      ensureInitialPage: false,
      onConnected: expect.any(Function),
      onDisconnected: expect.any(Function),
    });
    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { initialized: true, pages: [] },
    });
    expect(workerScope.__stagehand_runtime).toMatchObject({ state: "ready", connected: true });
  });

  it("keeps custom CDP sessions on the default browser-context path", async () => {
    const messages: unknown[] = [];
    const workerScope = scope(messages);
    startStagehandServiceWorker(workerScope, undefined, {
      resolveResidentWebSocketUrl: async () => "ws://resident.test/session",
    });

    await workerScope.__stagehandReceiveFromHost?.(initRequest("ws://custom.test/session"));

    expect(createBrowserContext).toHaveBeenCalledOnce();
    const [url, options] = createBrowserContext.mock.calls[0]!;
    expect(url).toBe("ws://custom.test/session");
    expect(options).not.toHaveProperty("restrictToWebTargets");
    expect(options).not.toHaveProperty("deferPageInstrumentation");
    expect(options).not.toHaveProperty("ensureInitialPage");
    expect(options).toHaveProperty("bootstrapLogger");
    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { initialized: true, pages: [] },
    });
    expect(workerScope.__stagehand_runtime).toMatchObject({
      state: "unconfigured",
      connected: false,
    });
  });
});

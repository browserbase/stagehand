import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGEHAND_SEND_TO_HOST_BINDING } from "../../protocol/schema-registry.js";

const mocks = vi.hoisted(() => {
  const setActive = vi.fn(async (_active: boolean) => {});
  return {
    setActive,
    createController: vi.fn(() => ({ setActive })),
    browserSession: undefined as unknown,
  };
});

vi.mock("../agentIndicatorController.ts", () => ({
  createAgentIndicatorController: mocks.createController,
}));

vi.mock("../understudy/context.ts", () => ({
  V3Context: {
    create: vi.fn(async () => mocks.browserSession),
  },
}));

import {
  startStagehandServiceWorker,
  type StagehandServiceWorkerScope,
} from "../service-worker.js";

function createBrowserSession() {
  return {
    connected: true,
    getVersion: async () => ({}),
    pages: () => [],
    newPage: async () => {
      throw new Error("Not used by this test");
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

describe("service worker agent indicator wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("activates on initialization and deactivates on close", async () => {
    mocks.browserSession = createBrowserSession();
    const chromeApi = {
      runtime: { getURL: (path: string) => `chrome-extension://stagehand/${path}` },
    };
    vi.stubGlobal("chrome", chromeApi);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "locator runtime" })),
    );

    let resolveResponse: ((value: unknown) => void) | undefined;
    const scope: StagehandServiceWorkerScope & Record<string, unknown> = {
      [STAGEHAND_SEND_TO_HOST_BINDING]: (payload: string) => {
        const message = JSON.parse(payload) as { id?: unknown };
        if (message.id === undefined) return;
        resolveResponse?.(message);
        resolveResponse = undefined;
      },
    };
    startStagehandServiceWorker(scope);
    expect(mocks.createController).toHaveBeenCalledWith(chromeApi);

    const send = async (id: number, method: string, params: object) =>
      await new Promise((resolve, reject) => {
        resolveResponse = resolve;
        void scope
          .__stagehandReceiveFromHost?.(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
          .catch(reject);
      });

    await send(1, "runtime.configure", {
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    });
    await send(2, "stagehand.init", { agentIndicator: true });
    expect(mocks.setActive).toHaveBeenCalledTimes(1);
    expect(mocks.setActive).toHaveBeenLastCalledWith(true);

    await send(3, "stagehand.close", {});
    expect(mocks.setActive.mock.calls).toStrictEqual([[true], [false]]);
  });
});

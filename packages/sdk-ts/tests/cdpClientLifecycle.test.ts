import { describe, expect, it } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import {
  discoverInstalledStagehandExtensionId,
  loadUnpackedExtension,
  resolveBrowserWebSocketUrl,
  StagehandRuntimeIncompatibleError,
  waitForRuntimeReady,
  waitForServiceWorker,
} from "../src/cdpClient.js";

type CdpCall = {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  signal?: AbortSignal;
};

const lifecycleSignal = new AbortController().signal;

type TargetInfo = {
  targetId: string;
  type: string;
  title: string;
  url: string;
};

type FakeCdpResult = Record<string, unknown>;

class FakeCdp {
  readonly calls: CdpCall[] = [];
  handlers = new Map<string, () => FakeCdpResult | Promise<FakeCdpResult>>();

  on(method: string, handler: () => FakeCdpResult | Promise<FakeCdpResult>): this {
    this.handlers.set(method, handler);
    return this;
  }

  async sendCommand<Result>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<Result> {
    this.calls.push({ method, params, sessionId, signal });
    const handler = this.handlers.get(method);

    if (!handler) {
      return {} as Result;
    }

    return (await handler()) as Result;
  }
}

describe("resolveBrowserWebSocketUrl", () => {
  it("returns direct websocket URLs without fetching /json/version", async () => {
    await expect(
      resolveBrowserWebSocketUrl("ws://127.0.0.1:9222/devtools/browser/1", {
        signal: lifecycleSignal,
      }),
    ).resolves.toBe("ws://127.0.0.1:9222/devtools/browser/1");
  });

  it("retries /json/version until the websocket URL is available", async () => {
    const requestedUrls: string[] = [];

    await expect(
      resolveBrowserWebSocketUrl("http://127.0.0.1:9222", {
        signal: lifecycleSignal,
        pollIntervalMs: 1,
        delayFn: async () => {},
        fetchFn: async (url) => {
          requestedUrls.push(url);

          if (requestedUrls.length === 1) {
            throw new Error("connection refused");
          }

          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({
              webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/ready",
            }),
          };
        },
      }),
    ).resolves.toBe("ws://127.0.0.1:9222/devtools/browser/ready");

    expect(requestedUrls).toStrictEqual([
      "http://127.0.0.1:9222/json/version",
      "http://127.0.0.1:9222/json/version",
    ]);
  });

  it("stops /json/version polling when initialization is cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization cancelled");

    await expect(
      resolveBrowserWebSocketUrl("http://127.0.0.1:9222", {
        pollIntervalMs: 1,
        signal: controller.signal,
        delayFn: async () => {
          controller.abort(reason);
        },
        fetchFn: async () => ({
          ok: false,
          status: 503,
          statusText: "Unavailable",
          json: async () => ({}),
        }),
      }),
    ).rejects.toBe(reason);
  });
});

describe("loadUnpackedExtension", () => {
  it("returns the id from Extensions.loadUnpacked", async () => {
    const cdp = new FakeCdp().on("Extensions.loadUnpacked", () => ({ id: "stagehandext" }));

    await expect(
      loadUnpackedExtension(cdp, "/tmp/stagehand-extension", lifecycleSignal),
    ).resolves.toBe("stagehandext");
    expect(cdp.calls).toStrictEqual([
      {
        method: "Extensions.loadUnpacked",
        params: { path: "/tmp/stagehand-extension" },
        sessionId: undefined,
        signal: lifecycleSignal,
      },
    ]);
  });

  it("returns a clear error when Extensions.loadUnpacked is unavailable", async () => {
    const cdp = new FakeCdp().on("Extensions.loadUnpacked", () => {
      throw new Error("Method not found", {
        cause: {
          code: -32601,
          message: "Method not found",
          method: "Extensions.loadUnpacked",
        },
      });
    });

    await expect(
      loadUnpackedExtension(cdp, "/tmp/stagehand-extension", lifecycleSignal),
    ).rejects.toThrow("Launch with --load-extension");
  });

  it("rejects loadUnpacked responses without an extension id", async () => {
    const cdp = new FakeCdp().on("Extensions.loadUnpacked", () => ({}));

    await expect(
      loadUnpackedExtension(cdp, "/tmp/stagehand-extension", lifecycleSignal),
    ).rejects.toThrow("did not return an extension id");
  });
});

describe("waitForServiceWorker", () => {
  it("discovers a preloaded extension service worker by extension id", async () => {
    const worker = target("stagehand-worker", "chrome-extension://stagehandext/service-worker.js");
    const cdp = new FakeCdp().on("Target.getTargets", () => ({
      targetInfos: [
        target("wrong-worker", "chrome-extension://otherext/service-worker.js"),
        worker,
      ],
    }));

    await expect(
      waitForServiceWorker(cdp, {
        extensionId: "stagehandext",
        delayFn: async () => {},
        signal: lifecycleSignal,
      }),
    ).resolves.toStrictEqual(worker);
  });

  it("uses service-worker.js as the default worker URL match", async () => {
    const worker = target("stagehand-worker", "chrome-extension://stagehandext/service-worker.js");
    const cdp = new FakeCdp().on("Target.getTargets", () => ({
      targetInfos: [
        target("legacy-worker", "chrome-extension://stagehandext/service_worker.js"),
        worker,
      ],
    }));

    await expect(
      waitForServiceWorker(cdp, {
        extensionId: "stagehandext",
        delayFn: async () => {},
        signal: lifecycleSignal,
      }),
    ).resolves.toStrictEqual(worker);
  });

  it("wakes lazy MV3 workers with the options page and closes the activation target", async () => {
    const worker = target("stagehand-worker", "chrome-extension://stagehandext/service-worker.js");
    const targetLists: TargetInfo[][] = [[], [worker]];
    const cdp = new FakeCdp()
      .on("Target.getTargets", () => ({ targetInfos: targetLists.shift() ?? [worker] }))
      .on("Target.createTarget", () => ({ targetId: "activation-page" }))
      .on("Target.closeTarget", () => ({ success: true }));

    await expect(
      waitForServiceWorker(cdp, {
        activationDelayMs: 0,
        extensionId: "stagehandext",
        delayFn: async () => {},
        signal: lifecycleSignal,
      }),
    ).resolves.toStrictEqual(worker);

    expect(cdp.calls).toContainEqual(
      expect.objectContaining({
        method: "Target.createTarget",
        params: { url: "chrome-extension://stagehandext/wake-service-worker.html" },
      }),
    );
    expect(cdp.calls).toContainEqual(
      expect.objectContaining({
        method: "Target.closeTarget",
        params: { targetId: "activation-page" },
      }),
    );
  });
});

describe("discoverInstalledStagehandExtensionId", () => {
  it("returns the enabled Stagehand extension id from Chrome's inventory", async () => {
    const cdp = new FakeCdp().on("Extensions.getExtensions", () => ({
      extensions: [
        installedExtension("otherext", "Other Extension"),
        installedExtension("stagehandext", "Stagehand Runtime"),
      ],
    }));

    await expect(
      discoverInstalledStagehandExtensionId(cdp, { signal: lifecycleSignal }),
    ).resolves.toBe("stagehandext");

    expect(cdp.calls).toStrictEqual([
      {
        method: "Extensions.getExtensions",
        params: {},
        sessionId: undefined,
        signal: lifecycleSignal,
      },
    ]);
  });

  it("fails immediately when Stagehand is absent from Chrome's inventory", async () => {
    const cdp = new FakeCdp().on("Extensions.getExtensions", () => ({
      extensions: [installedExtension("otherext", "Other Extension")],
    }));

    await expect(
      discoverInstalledStagehandExtensionId(cdp, { signal: lifecycleSignal }),
    ).rejects.toThrow("Stagehand extension is not installed in the connected browser");
    expect(cdp.calls).toHaveLength(1);
  });
});

describe("waitForRuntimeReady", () => {
  it("resolves when the attached runtime exposes the Stagehand marker and RPC receiver", async () => {
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: {
        value: readyRuntime(),
      },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        delayFn: async () => {},
        signal: lifecycleSignal,
      }),
    ).resolves.toBeUndefined();

    expect(cdp.calls).toStrictEqual([
      {
        method: "Runtime.evaluate",
        params: expect.objectContaining({
          expression: expect.stringContaining("__stagehand_runtime"),
          returnByValue: true,
        }),
        sessionId: "worker-session",
        signal: lifecycleSignal,
      },
    ]);

    const expression = String(cdp.calls[0]?.params?.expression);
    expect(expression).toContain("__stagehand_runtime");
    expect(expression).toContain("hasReceiver");
    expect(expression).not.toContain("stagehand.v4");
  });

  it("retries until the Stagehand runtime is ready", async () => {
    const readiness = [
      {
        marker: runtimeMarker(STAGEHAND_PROTOCOL_VERSION),
        hasReceiver: false,
      },
      readyRuntime(),
    ];
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: {
        value: readiness.shift() ?? readyRuntime(),
      },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 5,
        delayFn: async () => {},
        signal: lifecycleSignal,
      }),
    ).resolves.toBeUndefined();

    expect(cdp.calls.filter((call) => call.method === "Runtime.evaluate")).toHaveLength(2);
  });

  it("keeps polling a non-Stagehand runtime until initialization is cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization cancelled");
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: {
        value: {
          marker: {
            protocolVersion: STAGEHAND_PROTOCOL_VERSION,
            serverInfo: { name: "other-extension", version: "1" },
          },
          hasReceiver: false,
        },
      },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        signal: controller.signal,
        delayFn: async () => {
          controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
  });

  it("keeps retrying when readiness evaluation throws", async () => {
    const results = [
      {
        exceptionDetails: {
          text: "ReferenceError",
        },
      },
      {
        result: {
          value: readyRuntime(),
        },
      },
    ];
    const cdp = new FakeCdp().on("Runtime.evaluate", () => results.shift() ?? {});

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        delayFn: async () => {},
        signal: lifecycleSignal,
      }),
    ).resolves.toBeUndefined();

    expect(cdp.calls.filter((call) => call.method === "Runtime.evaluate")).toHaveLength(2);
  });

  it("keeps polling a malformed readiness envelope until initialization is cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization cancelled");
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({}));

    const error = await rejectedError(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        signal: controller.signal,
        delayFn: async () => {
          controller.abort(reason);
        },
      }),
    );

    expect(error).toBe(reason);
  });

  it("keeps polling an out-of-range runtime by default until initialization is cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization cancelled");
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: { value: runtimeReadiness("2.0.0") },
    }));

    const error = await rejectedError(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        signal: controller.signal,
        delayFn: async () => {
          controller.abort(reason);
        },
      }),
    );

    expect(error).toBe(reason);
  });

  it("throws for an out-of-range attached runtime when fallback installation is disabled", async () => {
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: { value: runtimeReadiness("2.0.0") },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        allowFallbackInstall: false,
        delayFn: async () => {},
        signal: lifecycleSignal,
      }),
    ).rejects.toBeInstanceOf(StagehandRuntimeIncompatibleError);
  });

  it("does not accept markers with unknown descriptor fields", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization cancelled");
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: {
        value: {
          marker: { ...runtimeMarker(STAGEHAND_PROTOCOL_VERSION), status: "ready" },
          hasReceiver: true,
        },
      },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        signal: controller.signal,
        delayFn: async () => {
          controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
  });
});

function target(targetId: string, url: string): TargetInfo {
  return {
    targetId,
    type: "service_worker",
    title: "Service Worker",
    url,
  };
}

function installedExtension(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    version: "0.0.1",
    path: `/extensions/${id}`,
    enabled: true,
  };
}

function readyRuntime(): Record<string, unknown> {
  return {
    marker: runtimeMarker(STAGEHAND_PROTOCOL_VERSION),
    hasReceiver: true,
  };
}

function runtimeReadiness(protocolVersion: string): Record<string, unknown> {
  return {
    marker: runtimeMarker(protocolVersion),
    hasReceiver: true,
  };
}

function runtimeMarker(protocolVersion: string): Record<string, unknown> {
  return {
    protocolVersion,
    serverInfo: { name: "stagehand", version: "1.0.0" },
  };
}

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error("Expected promise to reject");
}

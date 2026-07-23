import { describe, expect, it } from "vite-plus/test";
import {
  loadUnpackedExtension,
  resolveBrowserWebSocketUrl,
  StagehandRuntimeIncompatibleError,
  waitForPreloadedStagehandServiceWorker,
  waitForRuntimeReady,
  waitForServiceWorker,
} from "../../../sdk-ts/src/cdpClient.ts";

type CdpCall = {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

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
  ): Promise<Result> {
    this.calls.push({ method, params, sessionId });
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
      resolveBrowserWebSocketUrl("ws://127.0.0.1:9222/devtools/browser/1"),
    ).resolves.toBe("ws://127.0.0.1:9222/devtools/browser/1");
  });

  it("retries /json/version until the websocket URL is available", async () => {
    const requestedUrls: string[] = [];
    let now = 0;

    await expect(
      resolveBrowserWebSocketUrl("http://127.0.0.1:9222", {
        pollIntervalMs: 1,
        timeout: 1_000,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
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

  it("includes the last /json/version error on timeout", async () => {
    let now = 0;

    await expect(
      resolveBrowserWebSocketUrl("http://127.0.0.1:9222", {
        pollIntervalMs: 1,
        timeout: 1,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
        fetchFn: async () => ({
          ok: false,
          status: 503,
          statusText: "Unavailable",
          json: async () => ({}),
        }),
      }),
    ).rejects.toThrow("last error: 503 Unavailable");
  });
});

describe("loadUnpackedExtension", () => {
  it("returns the id from Extensions.loadUnpacked", async () => {
    const cdp = new FakeCdp().on("Extensions.loadUnpacked", () => ({ id: "stagehandext" }));

    await expect(loadUnpackedExtension(cdp, "/tmp/stagehand-extension")).resolves.toBe(
      "stagehandext",
    );
    expect(cdp.calls).toStrictEqual([
      {
        method: "Extensions.loadUnpacked",
        params: { path: "/tmp/stagehand-extension" },
        sessionId: undefined,
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

    await expect(loadUnpackedExtension(cdp, "/tmp/stagehand-extension")).rejects.toThrow(
      "Launch with --load-extension",
    );
  });

  it("rejects loadUnpacked responses without an extension id", async () => {
    const cdp = new FakeCdp().on("Extensions.loadUnpacked", () => ({}));

    await expect(loadUnpackedExtension(cdp, "/tmp/stagehand-extension")).rejects.toThrow(
      "did not return an extension id",
    );
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
        timeout: 1_000,
        delayFn: async () => {},
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
        timeout: 1_000,
        delayFn: async () => {},
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
        timeout: 1_000,
        delayFn: async () => {},
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

describe("waitForPreloadedStagehandServiceWorker", () => {
  it("probes candidate workers and returns the one with the Stagehand runtime", async () => {
    const wrongWorker = target("wrong-worker", "chrome-extension://otherext/service-worker.js");
    const stagehandWorker = target(
      "stagehand-worker",
      "chrome-extension://stagehandext/service-worker.js",
    );
    const attachedSessions = ["wrong-session", "stagehand-session"];
    const readiness = [
      {
        marker: {
          protocolVersion: 4,
          serverInfo: { name: "other", version: "1" },
        },
        hasReceiver: false,
      },
      readyRuntime(),
    ];
    const cdp = new FakeCdp()
      .on("Target.getTargets", () => ({ targetInfos: [wrongWorker, stagehandWorker] }))
      .on("Target.attachToTarget", () => ({ sessionId: attachedSessions.shift() }))
      .on("Runtime.evaluate", () => ({ result: { value: readiness.shift() } }))
      .on("Target.detachFromTarget", () => ({}));

    await expect(
      waitForPreloadedStagehandServiceWorker(cdp, {
        timeout: 1_000,
        nowFn: () => 0,
        delayFn: async () => {},
      }),
    ).resolves.toStrictEqual({
      serviceWorker: stagehandWorker,
      sessionId: "stagehand-session",
    });

    expect(cdp.calls).toContainEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: "wrong-session" },
      sessionId: undefined,
    });
    expect(cdp.calls.some((call) => call.method === "Extensions.loadUnpacked")).toBe(false);
  });

  it("skips a stale Stagehand runtime and selects the compatible version", async () => {
    const staleWorker = target("stale-worker", "chrome-extension://staleext/service-worker.js");
    const currentWorker = target(
      "current-worker",
      "chrome-extension://currentext/service-worker.js",
    );
    const attachedSessions = ["stale-session", "current-session"];
    const readiness = [runtimeReadiness(3), readyRuntime()];
    const cdp = new FakeCdp()
      .on("Target.getTargets", () => ({ targetInfos: [staleWorker, currentWorker] }))
      .on("Target.attachToTarget", () => ({ sessionId: attachedSessions.shift() }))
      .on("Runtime.evaluate", () => ({ result: { value: readiness.shift() } }))
      .on("Target.detachFromTarget", () => ({}));

    await expect(
      waitForPreloadedStagehandServiceWorker(cdp, {
        timeout: 1_000,
        nowFn: () => 0,
        delayFn: async () => {},
      }),
    ).resolves.toStrictEqual({
      serviceWorker: currentWorker,
      sessionId: "current-session",
    });

    expect(cdp.calls).toContainEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: "stale-session" },
      sessionId: undefined,
    });
  });

  it("times out with the observed protocol version when the only runtime is stale", async () => {
    let now = 0;
    const staleWorker = target("stale-worker", "chrome-extension://staleext/service-worker.js");
    const cdp = new FakeCdp()
      .on("Target.getTargets", () => ({ targetInfos: [staleWorker] }))
      .on("Target.attachToTarget", () => ({ sessionId: "stale-session" }))
      .on("Runtime.evaluate", () => ({
        result: { value: runtimeReadiness(3) },
      }))
      .on("Target.detachFromTarget", () => ({}));

    const error = await rejectedError(
      waitForPreloadedStagehandServiceWorker(cdp, {
        pollIntervalMs: 1,
        timeout: 1,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
      }),
    );

    expect(error).not.toBeInstanceOf(StagehandRuntimeIncompatibleError);
    expect(error.message).toContain("Timed out discovering the preloaded Stagehand service worker");
    expect(error.message).toContain("protocolVersion:3");

    expect(cdp.calls).toContainEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: "stale-session" },
      sessionId: undefined,
    });
  });

  it("throws for a stale runtime when fallback installation is disabled", async () => {
    let now = 0;
    const staleWorker = target("stale-worker", "chrome-extension://staleext/service-worker.js");
    const cdp = new FakeCdp()
      .on("Target.getTargets", () => ({ targetInfos: [staleWorker] }))
      .on("Target.attachToTarget", () => ({ sessionId: "stale-session" }))
      .on("Runtime.evaluate", () => ({ result: { value: runtimeReadiness(3) } }))
      .on("Target.detachFromTarget", () => ({}));

    await expect(
      waitForPreloadedStagehandServiceWorker(cdp, {
        allowFallbackInstall: false,
        pollIntervalMs: 1,
        timeout: 1,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
      }),
    ).rejects.toBeInstanceOf(StagehandRuntimeIncompatibleError);

    expect(cdp.calls).toContainEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: "stale-session" },
      sessionId: undefined,
    });
  });

  it("continues past a stale runtime when fallback installation is disabled", async () => {
    const staleWorker = target("stale-worker", "chrome-extension://staleext/service-worker.js");
    const currentWorker = target(
      "current-worker",
      "chrome-extension://currentext/service-worker.js",
    );
    const attachedSessions = ["stale-session", "current-session"];
    const readiness = [runtimeReadiness(3), readyRuntime()];
    const cdp = new FakeCdp()
      .on("Target.getTargets", () => ({ targetInfos: [staleWorker, currentWorker] }))
      .on("Target.attachToTarget", () => ({ sessionId: attachedSessions.shift() }))
      .on("Runtime.evaluate", () => ({ result: { value: readiness.shift() } }))
      .on("Target.detachFromTarget", () => ({}));

    await expect(
      waitForPreloadedStagehandServiceWorker(cdp, {
        allowFallbackInstall: false,
        timeout: 1_000,
        nowFn: () => 0,
        delayFn: async () => {},
      }),
    ).resolves.toStrictEqual({
      serviceWorker: currentWorker,
      sessionId: "current-session",
    });

    expect(cdp.calls).toContainEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: "stale-session" },
      sessionId: undefined,
    });
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
        timeout: 1_000,
        delayFn: async () => {},
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
      },
    ]);

    const expression = String(cdp.calls[0]?.params?.expression);
    expect(expression).toContain("__stagehand_runtime");
    expect(expression).toContain("hasReceiver");
    expect(expression).not.toContain("stagehand.v4");
  });

  it("retries until the Stagehand runtime is ready", async () => {
    let now = 0;
    const readiness = [
      {
        marker: runtimeMarker(4),
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
        timeout: 100,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
      }),
    ).resolves.toBeUndefined();

    expect(cdp.calls.filter((call) => call.method === "Runtime.evaluate")).toHaveLength(2);
  });

  it("returns a clear error when the worker is not a Stagehand runtime", async () => {
    let now = 0;
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: {
        value: {
          marker: {
            protocolVersion: 4,
            serverInfo: { name: "other-extension", version: "1" },
          },
          hasReceiver: false,
        },
      },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        timeout: 2,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
      }),
    ).rejects.toThrow("Timed out waiting for the Stagehand extension runtime to become ready");
  });

  it("keeps retrying when readiness evaluation throws", async () => {
    let now = 0;
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
        timeout: 10,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
      }),
    ).resolves.toBeUndefined();

    expect(cdp.calls.filter((call) => call.method === "Runtime.evaluate")).toHaveLength(2);
  });

  it("reports a malformed readiness envelope without a Zod error dump", async () => {
    let now = 0;
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({}));

    const error = await rejectedError(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        timeout: 1,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
      }),
    );

    expect(error.message).toContain("protocolVersion=undefined, __stagehandReceiveFromHost=false");
    expect(error.message).not.toContain("invalid_type");
    expect(error.message).not.toContain("ZodError");
  });

  it("times out on an out-of-range runtime by default", async () => {
    let now = 0;
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: { value: runtimeReadiness(3) },
    }));

    const error = await rejectedError(
      waitForRuntimeReady(cdp, "worker-session", {
        pollIntervalMs: 1,
        timeout: 1,
        nowFn: () => now,
        delayFn: async (ms) => {
          now += ms;
        },
      }),
    );

    expect(error).not.toBeInstanceOf(StagehandRuntimeIncompatibleError);
    expect(error.message).toContain(
      "Timed out waiting for the Stagehand extension runtime to become ready",
    );
    expect(error.message).toContain("protocolVersion=3");
    expect(error.message).not.toContain("undefined");
  });

  it("throws for an out-of-range attached runtime when fallback installation is disabled", async () => {
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: { value: runtimeReadiness(3) },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        allowFallbackInstall: false,
        timeout: 1_000,
        nowFn: () => 0,
        delayFn: async () => {},
      }),
    ).rejects.toBeInstanceOf(StagehandRuntimeIncompatibleError);
  });

  it("accepts compatible markers with unknown descriptor fields", async () => {
    const cdp = new FakeCdp().on("Runtime.evaluate", () => ({
      result: {
        value: {
          marker: { ...runtimeMarker(4), status: "ready" },
          hasReceiver: true,
        },
      },
    }));

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        timeout: 1_000,
        delayFn: async () => {},
      }),
    ).resolves.toBeUndefined();
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

function readyRuntime(): Record<string, unknown> {
  return {
    marker: runtimeMarker(4),
    hasReceiver: true,
  };
}

function runtimeReadiness(protocolVersion: number): Record<string, unknown> {
  return {
    marker: runtimeMarker(protocolVersion),
    hasReceiver: true,
  };
}

function runtimeMarker(protocolVersion: number): Record<string, unknown> {
  return {
    protocolVersion,
    serverInfo: { name: "stagehand", version: "4.0.0" },
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

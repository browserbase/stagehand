import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import {
  CDPClient,
  CDPConnectionClosedError,
  openCDPWebSocket,
  stagehandMessageExpression,
  StagehandRuntimeIncompatibleError,
  waitForPreloadedStagehandServiceWorker,
  waitForRuntimeReady,
  waitForServiceWorker,
} from "../src/cdpClient.js";
import { RUNTIME_INCOMPATIBILITY_REMEDIATION } from "../src/runtimeCompatibility.js";
import * as publicEntry from "../src/index.js";

const NEXT_MAJOR_PROTOCOL_VERSION = `${Number(STAGEHAND_PROTOCOL_VERSION.split(".")[0]) + 1}.0.0`;

type RuntimeReadiness = { marker: unknown; hasReceiver: boolean };

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error("expected the promise to reject");
    },
    (cause: unknown) => cause,
  );
}

const compatibleReadiness: RuntimeReadiness = {
  marker: {
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    serverInfo: { name: "stagehand", version: "1.0.0" },
  },
  hasReceiver: true,
};
const incompatibleReadiness: RuntimeReadiness = {
  marker: {
    protocolVersion: NEXT_MAJOR_PROTOCOL_VERSION,
    serverInfo: { name: "stagehand", version: "9.9.9" },
  },
  hasReceiver: true,
};
const foreignRuntimeReadiness: RuntimeReadiness = {
  marker: {
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    serverInfo: { name: "other-runtime", version: "1.0.0" },
  },
  hasReceiver: true,
};
const unknownReadiness: RuntimeReadiness = { marker: null, hasReceiver: false };

/** A CDP stub whose Runtime.evaluate answers come from `readiness`, one entry per poll. */
function readinessCdp(readiness: RuntimeReadiness[]) {
  const evaluations: RuntimeReadiness[] = [...readiness];
  const evaluate = vi.fn(() => {
    const next = evaluations.length > 1 ? evaluations.shift() : evaluations[0];
    return { result: { value: next } };
  });
  const sendCommand = vi.fn(
    async (
      method: string,
      _params?: Record<string, unknown>,
      sessionId?: string,
    ): Promise<Record<string, unknown>> => {
      if (method === "Runtime.evaluate") return evaluate();
      if (method === "Target.getTargets") {
        return {
          targetInfos: [
            {
              targetId: "worker-target",
              type: "service_worker",
              title: "Stagehand",
              url: "chrome-extension://stagehand/service-worker.js",
            },
          ],
        };
      }
      if (method === "Target.attachToTarget") return { sessionId: sessionId ?? "worker-session" };
      return {};
    },
  );
  return {
    evaluate,
    sendCommand,
    cdp: {
      async sendCommand<Result = Record<string, unknown>>(
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string,
        signal?: AbortSignal,
      ): Promise<Result> {
        void signal;
        return (await sendCommand(method, params, sessionId)) as Result;
      },
    },
  };
}

describe("callback batch expression", () => {
  it("serializes input separately from executable callback source", () => {
    const callbackSource = "async ({ page }, input) => ({ title: await page.title(), input })";
    const message = {
      jsonrpc: "2.0" as const,
      id: 8,
      method: "stagehand.callback_batch",
      params: {
        callback_source: callbackSource,
        input: { text: '"); globalThis.__injectionSucceeded = true; ("' },
        options: { page_id: "page-1", timeout: 2_000 },
      },
    };
    const expression = stagehandMessageExpression(message);

    expect(expression).toContain("__stagehandReceiveFromHost");
    expect(expression).toContain("stagehand.callback_batch");
    expect(expression).toContain(String.raw`\"page_id\":\"page-1\"`);
    expect(expression).not.toContain('"); globalThis.__injectionSucceeded = true; ("');
    expect(expression).toContain("Object.defineProperty");
    expect(expression).toContain("callback: (async");

    let receivedRaw: unknown;
    const workerGlobal = {
      __stagehandReceiveFromHost: (raw: unknown) => {
        receivedRaw = raw;
      },
    };
    expect(runInNewContext(expression, { globalThis: workerGlobal })).toBe(true);
    expect(JSON.parse(receivedRaw as string)).toEqual(message);
    expect(workerGlobal).not.toHaveProperty("__injectionSucceeded");
  });

  it("provides the lexical __name helper used by bundled callback source", async () => {
    const expression = stagehandMessageExpression({
      jsonrpc: "2.0",
      id: 8,
      method: "stagehand.callback_batch",
      params: {
        callback_source: '__name(async () => "ok", "bundledCallback")',
      },
    });
    let attachment: unknown;
    const evaluated = runInNewContext(expression, {
      globalThis: {
        __stagehandReceiveFromHost: (_raw: unknown, received: unknown) => {
          attachment = received;
        },
      },
    }) as unknown;

    expect(evaluated).toBe(true);
    const callback = (attachment as { callback: () => Promise<string> }).callback;
    expect(callback.name).toBe("bundledCallback");
    await expect(callback()).resolves.toBe("ok");
  });
});

class FakeWebSocket extends EventTarget {
  readyState = 0;
  send = vi.fn();
  close = vi.fn();

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  fail(error: Error): void {
    const event = new Event("error");
    Object.defineProperty(event, "error", { value: error });
    this.dispatchEvent(event);
  }
}

describe("CDP WebSocket transport", () => {
  it("opens the built-in WebSocket transport", async () => {
    const signal = new AbortController().signal;
    const socket = new FakeWebSocket();
    const createSocket = vi.fn(() => socket as never);
    const connecting = openCDPWebSocket(
      "wss://browser.example/devtools/browser/session",
      signal,
      createSocket,
    );

    socket.open();

    await expect(connecting).resolves.toBe(socket);
    expect(createSocket).toHaveBeenCalledWith("wss://browser.example/devtools/browser/session");
  });

  it("forwards socket errors that occur after connection", () => {
    const socket = new FakeWebSocket();
    const client = new CDPClient(socket as never, "wss://browser.example/devtools/browser/session");
    const onerror = vi.fn();
    const error = new Error("socket reset");
    client.onerror = onerror;

    socket.fail(error);

    expect(onerror).toHaveBeenCalledWith(error);
  });

  it("fails runtime readiness immediately when CDP disconnects", async () => {
    const disconnect = new CDPConnectionClosedError();
    const delayFn = vi.fn(async () => {});
    const signal = new AbortController().signal;
    const cdp = {
      sendCommand: vi.fn(async () => {
        throw disconnect;
      }),
    };

    await expect(waitForRuntimeReady(cdp, "worker-session", { delayFn, signal })).rejects.toBe(
      disconnect,
    );
    expect(delayFn).not.toHaveBeenCalled();
  });

  it("closes a wake target after cancellation without reusing the aborted signal", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization expired");
    const sendCommand = vi.fn(
      async (
        method: string,
        _params?: Record<string, unknown>,
        _sessionId?: string,
        _signal?: AbortSignal,
      ): Promise<Record<string, unknown>> => {
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Target.createTarget") return { targetId: "wake-target" };
        return {};
      },
    );
    const cdp = {
      async sendCommand<Result = Record<string, unknown>>(
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string,
        signal?: AbortSignal,
      ): Promise<Result> {
        return (await sendCommand(method, params, sessionId, signal)) as Result;
      },
    };

    const waiting = waitForServiceWorker(cdp, {
      extensionId: "stagehand-extension",
      activationDelayMs: 0,
      signal: controller.signal,
      delayFn: async () => controller.abort(reason),
    });

    await expect(waiting).rejects.toBe(reason);
    expect(sendCommand).toHaveBeenCalledWith("Target.getTargets", {}, undefined, controller.signal);
    expect(sendCommand).toHaveBeenCalledWith(
      "Target.createTarget",
      { url: "chrome-extension://stagehand-extension/wake-service-worker.html" },
      undefined,
      controller.signal,
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "Target.closeTarget",
      { targetId: "wake-target" },
      undefined,
      undefined,
    );
  });
});

describe("runtime compatibility fail-fast", () => {
  const signal = new AbortController().signal;

  it("exports StagehandRuntimeIncompatibleError from the public entry", () => {
    expect(publicEntry.StagehandRuntimeIncompatibleError).toBe(StagehandRuntimeIncompatibleError);
  });

  it("rejects an incompatible runtime marker on the first poll by default", async () => {
    const { cdp, evaluate } = readinessCdp([incompatibleReadiness]);
    const delayFn = vi.fn(async () => {});

    const error = await rejectionOf(
      waitForRuntimeReady(cdp, "worker-session", { delayFn, signal }),
    );

    expect(error).toBeInstanceOf(StagehandRuntimeIncompatibleError);
    if (!(error instanceof StagehandRuntimeIncompatibleError)) throw error;
    expect(error.reason).toBe("protocol-major-mismatch");
    expect(error.clientProtocolVersion).toBe(STAGEHAND_PROTOCOL_VERSION);
    expect(error.extensionProtocolVersion).toBe(NEXT_MAJOR_PROTOCOL_VERSION);
    expect(error.extensionServerInfo).toStrictEqual({ name: "stagehand", version: "9.9.9" });
    expect(error.remediation).toBe(RUNTIME_INCOMPATIBILITY_REMEDIATION);
    expect(error.compatibility).toMatchObject({
      kind: "incompatible",
      reason: "protocol-major-mismatch",
      required: { protocolVersion: STAGEHAND_PROTOCOL_VERSION },
    });
    expect(error.message).toContain("protocol-major-mismatch");
    expect(error.message).toContain(`client protocol ${STAGEHAND_PROTOCOL_VERSION}`);
    expect(error.message).toContain(`extension protocol ${NEXT_MAJOR_PROTOCOL_VERSION}`);
    expect(error.message).toContain("extension stagehand/9.9.9");
    expect(error.message).toContain(RUNTIME_INCOMPATIBILITY_REMEDIATION);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
  });

  it("rejects a runtime that reports a foreign runtime name", async () => {
    const { cdp, evaluate } = readinessCdp([foreignRuntimeReadiness]);
    const delayFn = vi.fn(async () => {});

    const waiting = waitForRuntimeReady(cdp, "worker-session", { delayFn, signal });

    await expect(waiting).rejects.toMatchObject({
      name: "StagehandRuntimeIncompatibleError",
      reason: "runtime-name-mismatch",
      extensionServerInfo: { name: "other-runtime", version: "1.0.0" },
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
  });

  it("keeps polling through unknown markers until the runtime is compatible", async () => {
    const { cdp, evaluate } = readinessCdp([
      unknownReadiness,
      unknownReadiness,
      unknownReadiness,
      compatibleReadiness,
    ]);
    const delayFn = vi.fn(async () => {});

    await expect(
      waitForRuntimeReady(cdp, "worker-session", { delayFn, signal }),
    ).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(delayFn).toHaveBeenCalledTimes(3);
  });

  it("keeps polling past an incompatible marker when fallback install is allowed", async () => {
    const { cdp, evaluate } = readinessCdp([incompatibleReadiness, compatibleReadiness]);
    const delayFn = vi.fn(async () => {});

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        delayFn,
        signal,
        allowFallbackInstall: true,
      }),
    ).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalledTimes(1);
  });

  it("still fails fast when fallback install is explicitly disabled", async () => {
    const { cdp, evaluate } = readinessCdp([incompatibleReadiness]);
    const delayFn = vi.fn(async () => {});

    await expect(
      waitForRuntimeReady(cdp, "worker-session", {
        delayFn,
        signal,
        allowFallbackInstall: false,
      }),
    ).rejects.toBeInstanceOf(StagehandRuntimeIncompatibleError);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
  });

  it("rejects an incompatible preloaded service worker in the first sweep", async () => {
    const { cdp, evaluate, sendCommand } = readinessCdp([incompatibleReadiness]);
    const delayFn = vi.fn(async () => {});

    const waiting = waitForPreloadedStagehandServiceWorker(cdp, { delayFn, signal });

    await expect(waiting).rejects.toBeInstanceOf(StagehandRuntimeIncompatibleError);
    await expect(waiting).rejects.toMatchObject({ reason: "protocol-major-mismatch" });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
    expect(sendCommand).toHaveBeenCalledWith(
      "Target.detachFromTarget",
      { sessionId: "worker-session" },
      undefined,
    );
  });

  it("keeps sweeping preloaded workers through unknown markers until one is compatible", async () => {
    const { cdp, evaluate } = readinessCdp([
      unknownReadiness,
      unknownReadiness,
      compatibleReadiness,
    ]);
    const delayFn = vi.fn(async () => {});

    await expect(
      waitForPreloadedStagehandServiceWorker(cdp, { delayFn, signal }),
    ).resolves.toMatchObject({
      sessionId: "worker-session",
      serviceWorker: { targetId: "worker-target" },
    });
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(delayFn).toHaveBeenCalledTimes(2);
  });

  it("keeps sweeping preloaded workers past an incompatible marker when fallback install is allowed", async () => {
    const { cdp, evaluate } = readinessCdp([incompatibleReadiness, compatibleReadiness]);
    const delayFn = vi.fn(async () => {});

    await expect(
      waitForPreloadedStagehandServiceWorker(cdp, { delayFn, signal, allowFallbackInstall: true }),
    ).resolves.toMatchObject({ sessionId: "worker-session" });
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalledTimes(1);
  });
});

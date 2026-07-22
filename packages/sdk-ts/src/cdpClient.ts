import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandSendToHostBindingSchema,
} from "../../protocol/schema-registry.js";
import { z } from "zod/v4";

type JsonObject = Record<string, unknown>;

type TargetInfo = {
  targetId: string;
  type: string;
  title: string;
  url: string;
};

export type ServiceWorkerInfo = {
  targetId: string;
  url: string;
  title: string;
  extensionId?: string;
};

export type CDPClientOptions = {
  cdpUrl: string;
  extensionDir?: string;
  extensionId?: string;
  preloadedExtension?: true;
  serviceWorkerUrlIncludes?: string;
  discoveryTimeoutMs: number;
  commandTimeoutMs: number;
  cdpConnectTimeoutMs: number;
};

type RuntimeEvaluateResult = {
  result?: {
    value?: unknown;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: unknown;
    };
  };
};

type RuntimeReadiness = {
  ok: boolean;
  runtimeName?: unknown;
  runtimeVersion?: unknown;
  hasStagehandReceiveFromHost: boolean;
};

type PendingCDPRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type VersionResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
};

type ResolveBrowserWebSocketUrlOptions = {
  timeout?: number;
  pollIntervalMs?: number;
  fetchFn?: (url: string) => Promise<VersionResponse>;
  delayFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
};

const RUNTIME_NAME = "stagehand";
const RUNTIME_VERSION = "stagehand.v4";

const CDPErrorSchema = z.looseObject({
  code: z.int(),
  message: z.string(),
  data: z.unknown().optional(),
});

const CDPCommandErrorCauseSchema = CDPErrorSchema.extend({
  method: z.string(),
});

const CDPResponseEnvelopeSchema = z.looseObject({
  id: z.int(),
  result: z.unknown().optional(),
  error: CDPErrorSchema.optional(),
  sessionId: z.string().optional(),
});

const CDPEventEnvelopeSchema = z.looseObject({
  method: z.string(),
  params: z.unknown().optional(),
  sessionId: z.string().optional(),
});

const RuntimeBindingCalledSchema = z.looseObject({
  name: StagehandSendToHostBindingSchema,
  payload: z.string(),
  executionContextId: z.int(),
});

const RuntimeReadinessSchema = z.object({
  ok: z.boolean(),
  runtimeName: z.unknown().optional(),
  runtimeVersion: z.unknown().optional(),
  hasStagehandReceiveFromHost: z.boolean(),
});

export class CDPConnectionClosedError extends Error {
  constructor() {
    super("CDP connection closed");
    this.name = "CDPConnectionClosedError";
  }
}

export class CDPClient {
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  readonly webSocketDebuggerUrl: string;
  nextId = 1;
  pending = new Map<number, PendingCDPRequest>();
  sessionId: string | undefined;
  attachedServiceWorker: ServiceWorkerInfo | undefined;
  closed = false;

  constructor(
    readonly socket: WebSocket,
    webSocketDebuggerUrl: string,
    readonly commandTimeoutMs: number,
  ) {
    this.webSocketDebuggerUrl = webSocketDebuggerUrl;
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(event.data).catch((error: unknown) => {
        const normalized = asError(error);
        this.rejectPending(normalized);
        this.onerror?.(normalized);
      });
    });

    this.socket.addEventListener("close", () => {
      if (this.closed) return;
      this.closed = true;
      const reason = new CDPConnectionClosedError();
      this.rejectPending(reason);
      this.onclose?.(reason);
    });
  }

  static async connect(options: CDPClientOptions): Promise<CDPClient> {
    const webSocketDebuggerUrl = await resolveBrowserWebSocketUrl(options.cdpUrl, {
      timeout: options.cdpConnectTimeoutMs,
    });
    const socket = new WebSocket(webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out opening CDP WebSocket"));
      }, options.cdpConnectTimeoutMs);

      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );

      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("Failed to open CDP WebSocket"));
        },
        { once: true },
      );
    });

    const client = new CDPClient(socket, webSocketDebuggerUrl, options.commandTimeoutMs);

    try {
      let serviceWorker: TargetInfo;
      let attached: { sessionId: string };
      let extensionId: string | undefined;

      if (options.preloadedExtension) {
        const discovered = await waitForPreloadedStagehandServiceWorker(client, {
          urlIncludes: options.serviceWorkerUrlIncludes,
          timeout: options.discoveryTimeoutMs,
        });
        serviceWorker = discovered.serviceWorker;
        attached = { sessionId: discovered.sessionId };
        extensionId = extensionIdFromUrl(serviceWorker.url);
      } else {
        extensionId = options.extensionDir
          ? await loadUnpackedExtension(client, options.extensionDir)
          : options.extensionId;
        serviceWorker = await waitForServiceWorker(client, {
          extensionId,
          urlIncludes: options.serviceWorkerUrlIncludes,
          timeout: options.discoveryTimeoutMs,
        });
        attached = await client.sendCommand<{ sessionId: string }>("Target.attachToTarget", {
          targetId: serviceWorker.targetId,
          flatten: true,
        });
      }

      client.sessionId = attached.sessionId;
      client.attachedServiceWorker = {
        targetId: serviceWorker.targetId,
        title: serviceWorker.title,
        url: serviceWorker.url,
        extensionId,
      };

      await client.sendCommand("Runtime.enable", {}, attached.sessionId).catch(() => {});
      await client.sendCommand(
        "Runtime.addBinding",
        { name: STAGEHAND_SEND_TO_HOST_BINDING },
        attached.sessionId,
      );
      await waitForRuntimeReady(client, attached.sessionId, {
        timeout: options.discoveryTimeoutMs,
      });
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  get serviceWorker(): ServiceWorkerInfo {
    if (!this.attachedServiceWorker) {
      throw new Error("Stagehand service worker is not attached");
    }
    return this.attachedServiceWorker;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("CDP client is closed");
    if (!this.sessionId) throw new Error("Stagehand service worker is not attached");

    const serializedMessage = JSON.stringify(message);
    const evaluated = await this.sendCommand<RuntimeEvaluateResult>(
      "Runtime.evaluate",
      {
        expression: `void globalThis.__stagehandReceiveFromHost(${JSON.stringify(serializedMessage)}); true`,
        awaitPromise: false,
        returnByValue: true,
      },
      this.sessionId,
      this.commandTimeoutMs,
    );

    if (evaluated.exceptionDetails) {
      throw new Error(
        evaluated.exceptionDetails.exception?.description ??
          evaluated.exceptionDetails.text ??
          "Stagehand service worker rejected an RPC message",
      );
    }
  }

  async sendCommand<Result = JsonObject>(
    method: string,
    params: JsonObject = {},
    sessionId?: string,
    timeout = 10_000,
  ): Promise<Result> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CDP connection is not open");
    }

    const id = this.nextId++;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };

    return await new Promise<Result>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeout);

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as Result),
        reject,
        timeoutId,
      });

      this.socket.send(JSON.stringify(message));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onmessage = undefined;
    this.onclose = undefined;
    this.onerror = undefined;
    this.rejectPending(new Error("CDP client closed"));
    this.socket.close();
  }

  async handleMessage(data: unknown): Promise<void> {
    const text = await messageDataToString(data);
    const rawMessage = JSON.parse(text) as unknown;
    const response = CDPResponseEnvelopeSchema.safeParse(rawMessage);

    if (response.success) {
      this.handleResponse(response.data);
      return;
    }

    const event = CDPEventEnvelopeSchema.parse(rawMessage);
    if (event.method !== "Runtime.bindingCalled" || event.sessionId !== this.sessionId) return;

    const binding = RuntimeBindingCalledSchema.safeParse(event.params);
    if (!binding.success) return;
    void Promise.resolve(this.onmessage?.(binding.data.payload)).catch((error: unknown) => {
      this.onerror?.(asError(error));
    });
  }

  handleResponse(message: z.output<typeof CDPResponseEnvelopeSchema>): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;

    this.pending.delete(message.id);
    clearTimeout(pending.timeoutId);

    if (message.error) {
      pending.reject(
        new Error(message.error.message, {
          cause: CDPCommandErrorCauseSchema.parse({
            ...message.error,
            method: pending.method,
          }),
        }),
      );
      return;
    }

    pending.resolve(message.result);
  }

  rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
      clearTimeout(pending.timeoutId);
    }
    this.pending.clear();
  }
}

type CDPCommandSender = Pick<CDPClient, "sendCommand">;

export async function waitForRuntimeReady(
  cdp: CDPCommandSender,
  sessionId: string,
  options: {
    timeout: number;
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
    nowFn?: () => number;
  },
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const delayFn = options.delayFn ?? delay;
  const nowFn = options.nowFn ?? Date.now;
  const startedAt = nowFn();
  let lastReadiness: RuntimeReadiness | undefined;
  let lastError = "";

  while (nowFn() - startedAt < options.timeout) {
    try {
      const evaluated = await evaluateRuntimeReadiness(cdp, sessionId);

      if (evaluated.exceptionDetails) {
        lastError =
          evaluated.exceptionDetails.exception?.description ??
          evaluated.exceptionDetails.text ??
          "readiness evaluation threw";
      } else {
        const readiness = parseRuntimeReadiness(evaluated.result?.value);
        lastReadiness = readiness;

        if (readiness.ok) return;

        lastError = `runtime=${String(readiness.runtimeName)}/${String(
          readiness.runtimeVersion,
        )}, __stagehandReceiveFromHost=${String(readiness.hasStagehandReceiveFromHost)}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delayFn(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for the Stagehand extension runtime to become ready${
      lastError ? ` (${lastError})` : ""
    }`,
    { cause: lastReadiness },
  );
}

export async function waitForPreloadedStagehandServiceWorker(
  cdp: CDPCommandSender,
  options: {
    urlIncludes?: string;
    timeout: number;
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
    nowFn?: () => number;
  },
): Promise<{ serviceWorker: TargetInfo; sessionId: string }> {
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const delayFn = options.delayFn ?? delay;
  const nowFn = options.nowFn ?? Date.now;
  const startedAt = nowFn();
  const workerUrlIncludes = options.urlIncludes ?? "service-worker.js";
  let lastTargets: TargetInfo[] = [];

  while (nowFn() - startedAt < options.timeout) {
    const targets = await cdp.sendCommand<{ targetInfos: TargetInfo[] }>("Target.getTargets");
    lastTargets = targets.targetInfos;
    const candidates = targets.targetInfos.filter(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith("chrome-extension://") &&
        target.url.includes(workerUrlIncludes),
    );

    for (const serviceWorker of candidates) {
      let sessionId: string | undefined;
      try {
        const attached = await cdp.sendCommand<{ sessionId: string }>("Target.attachToTarget", {
          targetId: serviceWorker.targetId,
          flatten: true,
        });
        sessionId = attached.sessionId;
        const evaluated = await evaluateRuntimeReadiness(cdp, sessionId);
        if (!evaluated.exceptionDetails && parseRuntimeReadiness(evaluated.result?.value).ok) {
          return { serviceWorker, sessionId };
        }
      } catch {
        // The worker may still be starting. Detach and retry until discovery times out.
      }

      if (sessionId) {
        await cdp.sendCommand("Target.detachFromTarget", { sessionId }).catch(() => undefined);
      }
    }

    await delayFn(pollIntervalMs);
  }

  throw new Error(
    `Timed out discovering the preloaded Stagehand service worker. Observed targets: ${lastTargets
      .map((target) => `${target.type}:${target.url}`)
      .join(", ")}`,
  );
}

async function evaluateRuntimeReadiness(
  cdp: CDPCommandSender,
  sessionId: string,
): Promise<RuntimeEvaluateResult> {
  return await cdp.sendCommand<RuntimeEvaluateResult>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const runtime = globalThis.__stagehand_runtime;
        const hasStagehandReceiveFromHost =
          typeof globalThis.__stagehandReceiveFromHost === "function";
        return {
          ok: runtime?.name === ${JSON.stringify(RUNTIME_NAME)} &&
            runtime?.version === ${JSON.stringify(RUNTIME_VERSION)} &&
            hasStagehandReceiveFromHost,
          runtimeName: runtime?.name,
          runtimeVersion: runtime?.version,
          hasStagehandReceiveFromHost,
        };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
}

function extensionIdFromUrl(url: string): string | undefined {
  const match = /^chrome-extension:\/\/([^/]+)\//u.exec(url);
  return match?.[1];
}

export async function waitForServiceWorker(
  cdp: CDPCommandSender,
  options: {
    extensionId?: string;
    urlIncludes?: string;
    timeout: number;
    activationDelayMs?: number;
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
  },
): Promise<TargetInfo> {
  const startedAt = Date.now();
  const activationDelayMs = options.activationDelayMs ?? 1_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const delayFn = options.delayFn ?? delay;
  const workerUrlIncludes = options.urlIncludes ?? "service-worker.js";
  let lastTargets: TargetInfo[] = [];
  let activationTargetId: string | undefined;

  while (Date.now() - startedAt < options.timeout) {
    const targets = await cdp.sendCommand<{ targetInfos: TargetInfo[] }>("Target.getTargets");
    lastTargets = targets.targetInfos;
    const serviceWorker = targets.targetInfos.find(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith("chrome-extension://") &&
        (options.extensionId
          ? target.url.startsWith(`chrome-extension://${options.extensionId}/`)
          : true) &&
        target.url.includes(workerUrlIncludes),
    );

    if (serviceWorker) {
      if (activationTargetId) {
        await cdp
          .sendCommand("Target.closeTarget", { targetId: activationTargetId })
          .catch(() => {});
      }
      return serviceWorker;
    }

    if (options.extensionId && !activationTargetId && Date.now() - startedAt >= activationDelayMs) {
      const activation = await cdp
        .sendCommand<{ targetId?: string }>("Target.createTarget", {
          url: `chrome-extension://${options.extensionId}/wake-service-worker.html`,
        })
        .catch(() => undefined);
      activationTargetId = activation?.targetId;
    }

    await delayFn(pollIntervalMs);
  }

  if (activationTargetId) {
    await cdp.sendCommand("Target.closeTarget", { targetId: activationTargetId }).catch(() => {});
  }

  throw new Error(
    `Timed out discovering the Stagehand service worker target. Observed targets: ${lastTargets
      .map((target) => `${target.type}:${target.url}`)
      .join(", ")}`,
  );
}

export async function loadUnpackedExtension(
  cdp: CDPCommandSender,
  extensionDir: string,
): Promise<string> {
  let loaded: { id?: string };

  try {
    loaded = await cdp.sendCommand<{ id?: string }>("Extensions.loadUnpacked", {
      path: extensionDir,
    });
  } catch (error) {
    if (isExtensionsLoadUnpackedUnavailable(error)) {
      throw new Error(
        "This Chrome build does not support Extensions.loadUnpacked. Launch with --load-extension and connect using extensionId instead.",
        { cause: error },
      );
    }

    throw error;
  }

  if (!loaded.id) {
    throw new Error("Extensions.loadUnpacked did not return an extension id");
  }

  return loaded.id;
}

export async function resolveBrowserWebSocketUrl(
  cdpUrl: string,
  options: ResolveBrowserWebSocketUrlOptions = {},
): Promise<string> {
  if (cdpUrl.startsWith("ws://") || cdpUrl.startsWith("wss://")) return cdpUrl;

  const timeout = options.timeout ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const fetchFn = options.fetchFn ?? fetch;
  const delayFn = options.delayFn ?? delay;
  const nowFn = options.nowFn ?? Date.now;
  const baseUrl = cdpUrl.replace(/\/$/, "");
  const deadlineMs = nowFn() + timeout;
  let lastError = "";

  while (nowFn() <= deadlineMs) {
    try {
      const response = await fetchFn(`${baseUrl}/json/version`);

      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`;
      } else {
        const version = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
        lastError = "CDP version endpoint did not include webSocketDebuggerUrl";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delayFn(pollIntervalMs);
  }

  throw new Error(
    `Timed out resolving CDP WebSocket URL from ${baseUrl}${
      lastError ? ` (last error: ${lastError})` : ""
    }`,
  );
}

async function messageDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (data instanceof Blob) return data.text();

  const view = data as ArrayBufferView;
  return Buffer.from(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength).toString("utf8");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExtensionsLoadUnpackedUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const cause = CDPCommandErrorCauseSchema.safeParse(error.cause);
  if (!cause.success) return false;

  return (
    cause.data.method === "Extensions.loadUnpacked" &&
    (cause.data.code === -32601 || /method not found|wasn't found/i.test(cause.data.message))
  );
}

function parseRuntimeReadiness(value: unknown): RuntimeReadiness {
  const readiness = RuntimeReadinessSchema.safeParse(value);
  return readiness.success
    ? readiness.data
    : {
        ok: false,
        runtimeName: undefined,
        runtimeVersion: undefined,
        hasStagehandReceiveFromHost: false,
      };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";
import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandMethods,
  StagehandSendToHostBindingSchema,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import { z } from "zod/v4";
import {
  DEFAULT_RUNTIME_REQUIREMENT,
  negotiateRuntimeCompatibility,
  type RuntimeCompatibility,
  type RuntimeRequirement,
} from "./runtimeCompatibility.js";
import { abortable, abortableDelay, abortReason, throwIfAborted } from "./abort.js";

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
  runtimeRequirement?: RuntimeRequirement;
  allowFallbackInstall?: boolean;
  signal: AbortSignal;
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

type PendingCDPRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  removeAbortListener?: () => void;
};

type VersionResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
};

type ResolveBrowserWebSocketUrlOptions = {
  pollIntervalMs?: number;
  fetchFn?: (url: string, init?: { signal?: AbortSignal }) => Promise<VersionResponse>;
  delayFn?: (ms: number) => Promise<void>;
  signal: AbortSignal;
};

function callbackBatchExpression(input: {
  message: JSONRPCMessage;
  callbackSource: string;
}): string {
  const serializedMessage = JSON.stringify(JSON.stringify(input.message));
  return `(() => { const __name = (fn, name) => { try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch {} return fn; }; void globalThis.__stagehandReceiveFromHost(${serializedMessage}, { callback: (${input.callbackSource}) }); return true; })()`;
}

function callbackSourceFromMessage(message: JSONRPCMessage): string | undefined {
  if (!("method" in message) || message.method !== StagehandMethods.stagehandCallbackBatch.name) {
    return undefined;
  }
  const params = message.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new TypeError("Stagehand callback batch request is missing callback_source");
  }
  const source = params.callback_source;
  if (typeof source !== "string" || !source.trim()) {
    throw new TypeError("Stagehand callback batch request is missing callback_source");
  }
  return source;
}

export function stagehandMessageExpression(message: JSONRPCMessage): string {
  const callbackSource = callbackSourceFromMessage(message);
  return callbackSource
    ? callbackBatchExpression({ message, callbackSource })
    : `void globalThis.__stagehandReceiveFromHost(${JSON.stringify(JSON.stringify(message))}); true`;
}

export class StagehandRuntimeIncompatibleError extends Error {
  readonly reason;
  constructor(readonly compatibility: Extract<RuntimeCompatibility, { kind: "incompatible" }>) {
    super(
      "Incompatible Stagehand runtime: " +
        compatibility.detail +
        "; client protocol " +
        compatibility.required.protocolVersion +
        ", reported protocol " +
        String(compatibility.reported.protocolVersion) +
        ", server " +
        compatibility.reported.serverInfo.name +
        "/" +
        compatibility.reported.serverInfo.version,
    );
    this.name = "StagehandRuntimeIncompatibleError";
    this.reason = compatibility.reason;
  }
}

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

const RuntimeReadinessEnvelopeSchema = z.looseObject({
  marker: z.unknown(),
  hasReceiver: z.boolean(),
});

const InstalledExtensionSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  path: z.string(),
  enabled: z.boolean(),
});

const InstalledExtensionsResultSchema = z.looseObject({
  extensions: z.array(InstalledExtensionSchema),
});

const STAGEHAND_EXTENSION_NAME = "Stagehand Runtime";

export class CDPConnectionClosedError extends Error {
  constructor(options?: ErrorOptions) {
    super("CDP connection closed", options);
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

    this.socket.addEventListener("error", (event) => {
      if (this.closed) return;
      this.closed = true;
      const socketError = asError((event as Event & { error?: unknown }).error ?? event);
      const reason = new CDPConnectionClosedError({ cause: socketError });
      this.rejectPending(reason);
      try {
        this.socket.close();
      } catch {
        // The transport is already terminal; preserve the original socket failure.
      }
      this.onerror?.(reason);
    });
  }

  static async connect(options: CDPClientOptions): Promise<CDPClient> {
    const signal = options.signal;
    const webSocketDebuggerUrl = await resolveBrowserWebSocketUrl(options.cdpUrl, { signal });
    throwIfAborted(signal);
    const socket = await openCDPWebSocket(webSocketDebuggerUrl, signal);

    const client = new CDPClient(socket, webSocketDebuggerUrl);

    try {
      let extensionId: string;
      if (options.extensionDir) {
        extensionId = await loadUnpackedExtension(client, options.extensionDir, signal);
      } else if (options.extensionId) {
        extensionId = options.extensionId;
      } else if (options.preloadedExtension) {
        extensionId = await discoverInstalledStagehandExtensionId(client, { signal });
      } else {
        throw new Error(
          "Exactly one of extensionDir, extensionId, or preloadedExtension is required",
        );
      }
      const serviceWorker = await waitForServiceWorker(client, {
        extensionId,
        urlIncludes: options.serviceWorkerUrlIncludes,
        signal,
      });
      const attached = await client.sendCommand<{ sessionId: string }>(
        "Target.attachToTarget",
        {
          targetId: serviceWorker.targetId,
          flatten: true,
        },
        undefined,
        signal,
      );

      client.sessionId = attached.sessionId;
      client.attachedServiceWorker = {
        targetId: serviceWorker.targetId,
        title: serviceWorker.title,
        url: serviceWorker.url,
        extensionId,
      };

      await client.sendCommand("Runtime.enable", {}, attached.sessionId, signal).catch(() => {
        throwIfAborted(signal);
        return undefined;
      });
      await client.sendCommand(
        "Runtime.addBinding",
        { name: STAGEHAND_SEND_TO_HOST_BINDING },
        attached.sessionId,
        signal,
      );
      await waitForRuntimeReady(client, attached.sessionId, {
        runtimeRequirement: options.runtimeRequirement,
        allowFallbackInstall: options.allowFallbackInstall,
        signal,
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

  async send(message: JSONRPCMessage, signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error("CDP client is closed");
    if (!this.sessionId) throw new Error("Stagehand service worker is not attached");

    const expression = stagehandMessageExpression(message);
    const evaluated = await this.sendCommand<RuntimeEvaluateResult>(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: false,
        returnByValue: true,
      },
      this.sessionId,
      signal,
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
    signal?: AbortSignal,
  ): Promise<Result> {
    throwIfAborted(signal);
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CDP connection is not open");
    }

    const id = this.nextId++;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };

    return await new Promise<Result>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        reject(signal ? abortReason(signal) : new Error("CDP command aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as Result),
        reject,
        ...(signal
          ? { removeAbortListener: () => signal.removeEventListener("abort", onAbort) }
          : {}),
      });

      if (signal?.aborted) {
        onAbort();
        return;
      }
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(asError(error));
      }
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
    pending.removeAbortListener?.();

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
      pending.removeAbortListener?.();
    }
    this.pending.clear();
  }
}

type CDPWebSocketFactory = (url: string) => WebSocket;

export async function openCDPWebSocket(
  url: string,
  signal: AbortSignal,
  createSocket: CDPWebSocketFactory = (socketUrl) => new WebSocket(socketUrl),
): Promise<WebSocket> {
  throwIfAborted(signal);
  const socket = createSocket(url);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    const onAbort = () => {
      cleanup();
      socket.close();
      reject(signal ? abortReason(signal) : new Error("CDP WebSocket opening aborted"));
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to open CDP WebSocket"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    if (signal?.aborted) onAbort();
  });

  return socket;
}

type CDPCommandSender = {
  sendCommand<Result = JsonObject>(
    method: string,
    params?: JsonObject,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<Result>;
};

export async function waitForRuntimeReady(
  cdp: CDPCommandSender,
  sessionId: string,
  options: {
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
    runtimeRequirement?: RuntimeRequirement;
    allowFallbackInstall?: boolean;
    signal: AbortSignal;
  },
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const delayFn = options.delayFn ?? delay;

  while (true) {
    throwIfAborted(options.signal);
    const evaluated = await evaluateRuntimeReadiness(cdp, sessionId, options.signal);

    if (!evaluated.exceptionDetails) {
      const readiness = parseRuntimeReadiness(evaluated.result?.value);

      const compatibility = negotiateRuntimeCompatibility(
        options.runtimeRequirement ?? DEFAULT_RUNTIME_REQUIREMENT,
        readiness.marker,
      );
      if (compatibility.kind === "incompatible" && options.allowFallbackInstall === false)
        throw new StagehandRuntimeIncompatibleError(compatibility);
      if (compatibility.kind === "compatible" && readiness.hasReceiver) return;
    }

    await abortable(delayFn(pollIntervalMs), options.signal);
  }
}

export async function discoverInstalledStagehandExtensionId(
  cdp: CDPCommandSender,
  options: { signal: AbortSignal },
): Promise<string> {
  throwIfAborted(options.signal);
  const response = await cdp.sendCommand<unknown>(
    "Extensions.getExtensions",
    {},
    undefined,
    options.signal,
  );
  const installed = InstalledExtensionsResultSchema.parse(response).extensions.filter(
    (extension) => extension.name === STAGEHAND_EXTENSION_NAME,
  );
  const enabled = installed.filter((extension) => extension.enabled);

  if (enabled.length === 1) return enabled[0].id;
  if (enabled.length > 1) {
    const ids = enabled
      .map((extension) => extension.id)
      .sort()
      .join(", ");
    throw new Error(`Multiple enabled Stagehand extensions are installed: ${ids}`);
  }
  if (installed.length > 0) {
    throw new Error("Stagehand extension is installed in the connected browser but is disabled.");
  }
  throw new Error(
    "Stagehand extension is not installed in the connected browser. " +
      "The extension must be included when the Browserbase session is created.",
  );
}

async function evaluateRuntimeReadiness(
  cdp: CDPCommandSender,
  sessionId: string,
  signal: AbortSignal,
): Promise<RuntimeEvaluateResult> {
  return await cdp.sendCommand<RuntimeEvaluateResult>(
    "Runtime.evaluate",
    {
      expression: `(() => ({
  marker: globalThis.__stagehand_runtime ?? null,
  hasReceiver: typeof globalThis.__stagehandReceiveFromHost === "function",
}))()`,
      returnByValue: true,
    },
    sessionId,
    signal,
  );
}

function parseRuntimeReadiness(value: unknown): z.output<typeof RuntimeReadinessEnvelopeSchema> {
  const parsed = RuntimeReadinessEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : { marker: null, hasReceiver: false };
}

export async function waitForServiceWorker(
  cdp: CDPCommandSender,
  options: {
    extensionId: string;
    urlIncludes?: string;
    activationDelayMs?: number;
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
    signal: AbortSignal;
  },
): Promise<TargetInfo> {
  const startedAt = Date.now();
  const activationDelayMs = options.activationDelayMs ?? 1_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const delayFn = options.delayFn ?? delay;
  const workerUrlIncludes = options.urlIncludes ?? "service-worker.js";
  let activationTargetId: string | undefined;

  try {
    while (true) {
      throwIfAborted(options.signal);
      const targets = await cdp.sendCommand<{ targetInfos: TargetInfo[] }>(
        "Target.getTargets",
        {},
        undefined,
        options.signal,
      );
      const serviceWorker = targets.targetInfos.find(
        (target) =>
          target.type === "service_worker" &&
          target.url.startsWith("chrome-extension://") &&
          target.url.startsWith(`chrome-extension://${options.extensionId}/`) &&
          target.url.includes(workerUrlIncludes),
      );

      if (serviceWorker) return serviceWorker;

      if (!activationTargetId && Date.now() - startedAt >= activationDelayMs) {
        const activation = await cdp
          .sendCommand<{ targetId?: string }>(
            "Target.createTarget",
            {
              url: `chrome-extension://${options.extensionId}/wake-service-worker.html`,
            },
            undefined,
            options.signal,
          )
          .catch(() => {
            throwIfAborted(options.signal);
            return undefined;
          });
        activationTargetId = activation?.targetId;
      }

      await abortable(delayFn(pollIntervalMs), options.signal);
    }
  } finally {
    if (activationTargetId) {
      // Cleanup must not inherit an already-aborted init signal or delay its rejection.
      void cdp
        .sendCommand("Target.closeTarget", { targetId: activationTargetId })
        .catch(() => undefined);
    }
  }
}

export async function loadUnpackedExtension(
  cdp: CDPCommandSender,
  extensionDir: string,
  signal: AbortSignal,
): Promise<string> {
  let loaded: { id?: string };

  try {
    loaded = await cdp.sendCommand<{ id?: string }>(
      "Extensions.loadUnpacked",
      {
        path: extensionDir,
      },
      undefined,
      signal,
    );
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
  options: ResolveBrowserWebSocketUrlOptions,
): Promise<string> {
  throwIfAborted(options.signal);
  if (cdpUrl.startsWith("ws://") || cdpUrl.startsWith("wss://")) return cdpUrl;

  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const fetchFn = options.fetchFn ?? fetch;
  const delayFn = options.delayFn ?? delay;
  const baseUrl = cdpUrl.replace(/\/$/, "");

  while (true) {
    throwIfAborted(options.signal);
    try {
      const response = await abortable(
        fetchFn(`${baseUrl}/json/version`, { signal: options.signal }),
        options.signal,
      );

      if (response.ok) {
        const version = (await abortable(response.json(), options.signal)) as {
          webSocketDebuggerUrl?: string;
        };
        if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
      }
    } catch {
      throwIfAborted(options.signal);
    }

    await abortable(delayFn(pollIntervalMs), options.signal);
  }
}

async function messageDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (data instanceof Blob) return data.text();

  const view = data as ArrayBufferView;
  return Buffer.from(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength).toString("utf8");
}

function delay(ms: number): Promise<void> {
  return abortableDelay(ms);
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

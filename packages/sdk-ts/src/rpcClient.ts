import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  JSONRPCEnvelopeSchema,
  JSONRPCErrorCodes,
  JSONRPCErrorResponseSchema,
  JSONRPCRequestIdSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  JSONRPCWireInputSchema,
  type RPCMethod,
} from "../../protocol/json-rpc/schemas.js";
import type { JSONRPCMessage, JSONRPCResponse } from "../../protocol/json-rpc/types.js";
import { encodeWireValue, wireSchema } from "../../protocol/json-rpc/wire-casing.js";
import {
  StagehandNotifications,
  StagehandRPC,
  StagehandRpcNotificationSchema,
} from "../../protocol/schema-registry.js";
import { StagehandTelemetryOptionsSchema } from "../../protocol/schemas.js";
import type { StagehandRpcNotification } from "../../protocol/types.js";
import { z } from "zod/v4";
import { CDPClient, type ServiceWorkerInfo } from "./cdpClient.js";

type PendingRequest = {
  method: RPCMethod;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

const TRACER = trace.getTracer("@browserbasehq/stagehand");
const W3C_TRACE_CONTEXT_PROPAGATOR = new W3CTraceContextPropagator();
const MAX_PENDING_NOTIFICATIONS = 100;

const RPCClientOptionsBaseSchema = z
  .object({
    cdpUrl: z.string().min(1),
    serviceWorkerUrlIncludes: z.string().min(1).optional(),
    discoveryTimeoutMs: z.number().int().positive().optional(),
    commandTimeoutMs: z.number().int().positive().optional(),
    cdpConnectTimeoutMs: z.number().int().positive().optional(),
    telemetry: StagehandTelemetryOptionsSchema,
  })
  .strict();

export const RPCClientOptionsSchema = z.union([
  RPCClientOptionsBaseSchema.extend({
    extensionDir: z.string().min(1),
    extensionId: z.never().optional(),
  }).strict(),
  RPCClientOptionsBaseSchema.extend({
    extensionId: z.string().min(1),
    extensionDir: z.never().optional(),
  }).strict(),
]);

export type RPCClientOptions = z.input<typeof RPCClientOptionsSchema>;

export type CDPTransport = {
  readonly serviceWorker: ServiceWorkerInfo;
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  send(message: JSONRPCMessage): Promise<void>;
  close(): void;
};

export class RPCClientError extends Error {
  constructor(
    message: string,
    readonly code: number = JSONRPCErrorCodes.internalError,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RPCClientError";
  }
}

export class RPCClient {
  readonly serviceWorker: ServiceWorkerInfo;
  nextRequestId = 1;
  pending = new Map<number, PendingRequest>();
  notificationListeners = new Set<(notification: StagehandRpcNotification) => void>();
  pendingNotifications: StagehandRpcNotification[] = [];
  closed = false;
  readonly cdp: CDPTransport;
  readonly requestTimeoutMs: number;

  constructor(cdp: CDPTransport, requestTimeoutMs: number) {
    this.cdp = cdp;
    this.requestTimeoutMs = requestTimeoutMs;
    this.serviceWorker = cdp.serviceWorker;
    this.cdp.onmessage = (message) => this.receive(message);
    this.cdp.onclose = (reason) => this.close(reason);
    this.cdp.onerror = (error) => this.close(error);
  }

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    if (this.closed) throw new RPCClientError("RPC client is closed");

    const parentContext = otelContext.active();
    const span = TRACER.startSpan(
      method.name,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "rpc.system.name": "jsonrpc",
          "rpc.method": method.name,
        },
      },
      parentContext,
    );
    const requestContext = trace.setSpan(parentContext, span);
    const requestId = this.nextRequestId++;

    try {
      return await otelContext.with(requestContext, async () => {
        const parsedParams = method.params.parse(params);
        const request = JSONRPCRequestSchema.parse({
          jsonrpc: "2.0",
          id: requestId,
          method: method.name,
          params: encodeWireValue(parsedParams, method.paramsWire?.encode),
          ...getTraceContextFields(requestContext),
        });
        span.setAttribute("jsonrpc.request.id", String(request.id));

        const response = this.waitForResponse(request.id, method);
        const [, result] = await Promise.all([
          this.cdp.send(request).catch((error: unknown) => {
            this.rejectPending(request.id, asError(error));
          }),
          response,
        ]);
        return result as z.output<Method["result"]>;
      });
    } catch (error) {
      markClientSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  }

  onNotification(listener: (notification: StagehandRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    const pending = this.pendingNotifications;
    this.pendingNotifications = [];
    for (const notification of pending) listener(notification);

    return () => this.notificationListeners.delete(listener);
  }

  close(reason: Error = new RPCClientError("RPC client closed")): void {
    if (this.closed) return;
    this.closed = true;
    this.notificationListeners.clear();
    this.pendingNotifications = [];
    for (const [id] of this.pending) this.rejectPending(id, reason);
    this.cdp.onmessage = undefined;
    this.cdp.onclose = undefined;
    this.cdp.onerror = undefined;
    this.cdp.close();
  }

  waitForResponse(id: number, method: RPCMethod): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new RPCClientError(`RPC request timed out: ${method.name}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { method, resolve, reject, timeout });
    });
  }

  async receive(raw: unknown): Promise<void> {
    const wireInput = JSONRPCWireInputSchema.safeParse(raw);
    if (!wireInput.success) {
      await this.sendError(null, JSONRPCErrorCodes.parseError, "Parse error");
      return;
    }

    const envelope = JSONRPCEnvelopeSchema.safeParse(wireInput.data);
    if (!envelope.success) {
      await this.sendError(null, JSONRPCErrorCodes.invalidRequest, "Invalid request");
      return;
    }
    const message = envelope.data;

    if ("result" in message || "error" in message) {
      const response = JSONRPCResponseSchema.safeParse(message);
      if (!response.success) {
        this.close(new RPCClientError("Invalid JSON-RPC response"));
        return;
      }
      this.receiveResponse(response.data);
      return;
    }

    if ("method" in message && !("id" in message)) {
      const notification = StagehandRpcNotificationSchema.safeParse(message);
      if (!notification.success) return;
      this.handleNotification(notification.data);
      return;
    }

    const request = JSONRPCRequestSchema.safeParse(message);
    if (request.success) {
      await this.sendError(request.data.id, JSONRPCErrorCodes.methodNotFound, "Method not found");
      return;
    }

    const requestId = JSONRPCRequestIdSchema.safeParse(message.id);
    await this.sendError(
      requestId.success ? requestId.data : null,
      JSONRPCErrorCodes.invalidRequest,
      "Invalid request",
    );
  }

  receiveResponse(response: JSONRPCResponse): void {
    if (response.id === null) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if ("error" in response) {
      pending.reject(
        new RPCClientError(response.error.message, response.error.code, response.error.data),
      );
      return;
    }

    try {
      pending.resolve(
        wireSchema(pending.method.result, pending.method.resultWire?.decode).parse(response.result),
      );
    } catch (error) {
      pending.reject(asError(error));
    }
  }

  rejectPending(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  async sendError(id: number | null, code: number, message: string): Promise<void> {
    await this.cdp.send(
      JSONRPCErrorResponseSchema.parse({
        jsonrpc: "2.0",
        id,
        error: { code, message },
      }),
    );
  }

  handleNotification(notification: StagehandRpcNotification): void {
    if (notification.method !== StagehandNotifications.log.name) return;

    if (this.notificationListeners.size === 0) {
      if (this.pendingNotifications.length === MAX_PENDING_NOTIFICATIONS) {
        this.pendingNotifications.shift();
      }
      this.pendingNotifications.push(notification);
      return;
    }

    for (const listener of this.notificationListeners) listener(notification);
  }
}

export async function connectRPCClient(input: RPCClientOptions): Promise<RPCClient> {
  const options = RPCClientOptionsSchema.parse(input);
  const commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
  const cdpClient = await CDPClient.connect({
    cdpUrl: options.cdpUrl,
    ...(options.extensionDir ? { extensionDir: options.extensionDir } : {}),
    ...(options.extensionId ? { extensionId: options.extensionId } : {}),
    ...(options.serviceWorkerUrlIncludes
      ? { serviceWorkerUrlIncludes: options.serviceWorkerUrlIncludes }
      : {}),
    discoveryTimeoutMs: options.discoveryTimeoutMs ?? 10_000,
    cdpConnectTimeoutMs: options.cdpConnectTimeoutMs ?? 10_000,
    commandTimeoutMs,
  });
  const client = new RPCClient(cdpClient, commandTimeoutMs);

  try {
    await client.send(StagehandRPC.runtimeConfigure, {
      cdpUrl: cdpClient.webSocketDebuggerUrl,
      telemetry: options.telemetry,
    });
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export function getTraceContextFields(requestContext: Context): {
  traceparent?: string;
  tracestate?: string;
} {
  const fields: { traceparent?: string; tracestate?: string } = {};

  W3C_TRACE_CONTEXT_PROPAGATOR.inject(requestContext, fields, {
    set(carrier, key, value) {
      if (key === "traceparent" || key === "tracestate") carrier[key] = value;
    },
  });

  return fields;
}

function markClientSpanError(span: Span, error: unknown): void {
  if (error instanceof RPCClientError) {
    span.setAttribute("rpc.response.status_code", String(error.code));
    span.setAttribute("error.type", String(error.code));
  } else if (error instanceof Error) {
    span.setAttribute("error.type", error.name);
  }
  span.setStatus({ code: SpanStatusCode.ERROR });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

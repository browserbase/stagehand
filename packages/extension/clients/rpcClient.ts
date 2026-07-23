import {
  context,
  defaultTextMapSetter,
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
  JSONRPCNotificationSchema,
  JSONRPCRequestIdSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  JSONRPCSuccessResponseSchema,
  JSONRPCWireInputSchema,
  type RPCMethod,
  type RPCNotification,
} from "../../protocol/json-rpc/schemas.js";
import type { JSONRPCResponse } from "../../protocol/json-rpc/types.js";
import { encodeWireValue, wireSchema } from "../../protocol/json-rpc/wire-casing.js";
import { getStagehandMethod, StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";
import { z } from "zod/v4";
import { RPCRouter } from "../rpcRouter.js";
import { ChromeRuntimeClient } from "./chromeRuntimeClient.js";

type PendingRequest = {
  method: RPCMethod;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

const ERROR_DATA = {
  methodNotFound: { type: "stagehand.unknown_command" },
} as const;
const W3C_TRACE_CONTEXT_PROPAGATOR = new W3CTraceContextPropagator();

export class RPCClient {
  nextRequestId = 1;
  pending = new Map<number, PendingRequest>();
  closed = false;

  constructor(
    readonly runtime: ChromeRuntimeClient,
    readonly router: RPCRouter,
    readonly requestTimeoutMs = 60_000,
  ) {
    this.runtime.onmessage = (message) => this.receive(message);
    this.runtime.onclose = (reason) => this.close(reason);
    this.runtime.onerror = (error) => this.close(error);
  }

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    if (this.closed) throw new Error("RPC client is closed");

    const parentContext = context.active();
    const span = this.router.runtime.tracing.tracer.startSpan(
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
    const id = this.nextRequestId++;

    try {
      return await context.with(requestContext, async () => {
        const parsedParams = method.params.parse(params);
        const request = JSONRPCRequestSchema.parse({
          jsonrpc: "2.0",
          id,
          method: method.name,
          params: encodeWireValue(parsedParams, method.paramsWire),
          ...getTraceContextFields(requestContext),
        });
        span.setAttribute("jsonrpc.request.id", String(request.id));

        const response = this.waitForResponse(id, method);
        const [, result] = await Promise.all([
          this.runtime.send(request).catch((error: unknown) => {
            this.rejectPending(id, asError(error));
          }),
          response,
        ]);

        return result as z.output<Method["result"]>;
      });
    } catch (error) {
      markSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  }

  async notify<Notification extends RPCNotification>(
    notification: Notification,
    params: z.input<Notification["params"]>,
  ): Promise<void> {
    if (this.closed) throw new Error("RPC client is closed");

    await this.runtime.send(
      JSONRPCNotificationSchema.parse({
        jsonrpc: "2.0",
        method: notification.name,
        params: notification.params.parse(params),
      }),
    );
  }

  close(reason = new Error("RPC client closed")): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id] of this.pending) this.rejectPending(id, reason);
    this.runtime.onmessage = undefined;
    this.runtime.onclose = undefined;
    this.runtime.onerror = undefined;
    this.runtime.close();
  }

  waitForResponse(id: number, method: RPCMethod): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`RPC request timed out: ${method.name}`));
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
        this.close(new Error("Invalid JSON-RPC response"));
        return;
      }
      this.receiveResponse(response.data);
      return;
    }

    if ("method" in message && !("id" in message)) {
      if (JSONRPCNotificationSchema.safeParse(message).success) return;
      await this.sendError(null, JSONRPCErrorCodes.invalidRequest, "Invalid request");
      return;
    }

    const request = JSONRPCRequestSchema.safeParse(message);
    if (!request.success) {
      const requestId = JSONRPCRequestIdSchema.safeParse(message.id);
      await this.sendError(
        requestId.success ? requestId.data : null,
        JSONRPCErrorCodes.invalidRequest,
        "Invalid request",
      );
      return;
    }

    const method = getStagehandMethod(request.data.method);
    if (!method) {
      await this.sendError(
        request.data.id,
        JSONRPCErrorCodes.methodNotFound,
        "Method not found",
        ERROR_DATA.methodNotFound,
      );
      return;
    }

    const stagehandRequest = StagehandRpcRequestSchema.safeParse(request.data);
    if (!stagehandRequest.success) {
      await this.sendError(
        request.data.id,
        JSONRPCErrorCodes.invalidParams,
        stagehandRequest.error.message,
        { name: stagehandRequest.error.name, issues: stagehandRequest.error.issues },
      );
      return;
    }

    try {
      const result = await this.router.handle(stagehandRequest.data);
      const parsedResult = method.result.safeParse(result);
      if (!parsedResult.success) {
        await this.sendError(
          request.data.id,
          JSONRPCErrorCodes.internalError,
          parsedResult.error.message,
          { name: parsedResult.error.name, issues: parsedResult.error.issues },
        );
        return;
      }

      await this.runtime.send(
        JSONRPCSuccessResponseSchema.parse({
          jsonrpc: "2.0",
          id: request.data.id,
          result: encodeWireValue(parsedResult.data, method.resultWire),
        }),
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        await this.sendError(request.data.id, JSONRPCErrorCodes.invalidParams, error.message, {
          name: error.name,
          issues: error.issues,
        });
        return;
      }
      await this.sendError(
        request.data.id,
        JSONRPCErrorCodes.internalError,
        error instanceof Error ? error.message : String(error),
        { name: error instanceof Error ? error.name : "Error" },
      );
    }
  }

  receiveResponse(response: JSONRPCResponse): void {
    if (response.id === null) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if ("error" in response) {
      pending.reject(new Error(response.error.message, { cause: response.error }));
      return;
    }

    try {
      pending.resolve(
        wireSchema(pending.method.result, pending.method.resultWire).parse(response.result),
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

  async sendError(id: number | null, code: number, message: string, data?: unknown): Promise<void> {
    await this.runtime.send(
      JSONRPCErrorResponseSchema.parse({
        jsonrpc: "2.0",
        id,
        error: {
          code,
          message,
          ...(data === undefined ? {} : { data }),
        },
      }),
    );
  }
}

function getTraceContextFields(requestContext: Context): {
  traceparent?: string;
  tracestate?: string;
} {
  const fields: { traceparent?: string; tracestate?: string } = {};

  W3C_TRACE_CONTEXT_PROPAGATOR.inject(requestContext, fields, defaultTextMapSetter);

  return fields;
}

function markSpanError(span: Span, error: unknown): void {
  if (error instanceof Error) span.setAttribute("error.type", error.name);
  span.setStatus({ code: SpanStatusCode.ERROR });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

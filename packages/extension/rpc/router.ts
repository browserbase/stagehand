import {
  ROOT_CONTEXT,
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { z } from "zod/v4";
import {
  JSONRPCErrorCodes,
  JSONRPCErrorResponseSchema,
  JSONRPCRequestSchema,
  JSONRPCSuccessResponseSchema,
} from "../../protocol/json-rpc/schemas.js";
import type { JSONRPCResponse } from "../../protocol/json-rpc/types.js";
import { encodeWireValue } from "../../protocol/json-rpc/wire-casing.js";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";
import { StagehandRuntimeError } from "../services/stagehandRuntimeService.js";
import type { StagehandTracing } from "../tracing.js";

const W3C_TRACE_CONTEXT_PROPAGATOR = new W3CTraceContextPropagator();

export type StagehandHandlers = {
  [Method in keyof typeof StagehandMethods]: (
    params: z.output<(typeof StagehandMethods)[Method]["paramsSchema"]>,
  ) => Promise<z.output<(typeof StagehandMethods)[Method]["resultSchema"]>>;
};

export function createStagehandRouter(
  routes: StagehandHandlers,
  { tracing }: { tracing: StagehandTracing },
) {
  return async (raw: unknown): Promise<JSONRPCResponse> => {
    let input: unknown;

    try {
      input = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return rpcError(null, JSONRPCErrorCodes.parseError, "Parse error", "stagehand.parse_error");
    }

    const commandResult = JSONRPCRequestSchema.safeParse(input);

    if (!commandResult.success) {
      return rpcError(
        null,
        JSONRPCErrorCodes.invalidRequest,
        "Invalid request",
        "stagehand.invalid_request",
      );
    }

    const requestResult = StagehandRpcRequestSchema.safeParse(input);

    if (!requestResult.success) {
      const methodNotFound = requestResult.error.issues.some((issue) => issue.path[0] === "method");

      return methodNotFound
        ? rpcError(
            commandResult.data.id,
            JSONRPCErrorCodes.methodNotFound,
            "Method not found",
            "stagehand.unknown_command",
          )
        : rpcError(
            commandResult.data.id,
            JSONRPCErrorCodes.invalidParams,
            "Invalid params",
            "stagehand.invalid_params",
          );
    }

    const request = requestResult.data;
    const definition = StagehandMethods[request.method];
    const route = routes[request.method] as (params: typeof request.params) => Promise<unknown>;
    if (request.method === "runtime.configure") {
      tracing.configure(request.params.telemetry);
    }

    // CDP has no HTTP headers, so the bridge carries W3C trace context in flat JSON-RPC fields.
    const parentContext = W3C_TRACE_CONTEXT_PROPAGATOR.extract(ROOT_CONTEXT, request, {
      get(carrier, key) {
        if (key === "traceparent" || key === "tracestate") return carrier[key];
        return undefined;
      },
      keys(carrier) {
        return ["traceparent", "tracestate"].filter((key) => key in carrier);
      },
    });
    const span = tracing.tracer.startSpan(
      request.method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "rpc.system.name": "jsonrpc",
          "rpc.method": request.method,
          "jsonrpc.request.id": String(request.id),
        },
      },
      parentContext,
    );
    const requestContext = trace.setSpan(parentContext, span);
    const shutdownAfterResponse = request.method === "stagehand.close";

    try {
      // Make the server span active so dependency instrumentation joins the same trace.
      const result = await otelContext.with(requestContext, () => route(request.params));
      const resultResult = definition.resultSchema.safeParse(result);

      if (!resultResult.success) {
        setRpcErrorOnSpan(span, JSONRPCErrorCodes.internalError, "stagehand.invalid_result");
        return rpcError(
          request.id,
          JSONRPCErrorCodes.internalError,
          "Internal error",
          "stagehand.invalid_result",
        );
      }

      const resultWire = "resultWire" in definition ? definition.resultWire : undefined;

      return JSONRPCSuccessResponseSchema.parse({
        jsonrpc: "2.0",
        id: request.id,
        result: encodeWireValue(resultResult.data, resultWire?.encode),
      });
    } catch (error) {
      if (error instanceof StagehandRuntimeError) {
        setRpcErrorOnSpan(span, error.code, error.type, error.message);
        return rpcError(request.id, error.code, error.message, error.type);
      }

      setRpcErrorOnSpan(
        span,
        JSONRPCErrorCodes.internalError,
        "stagehand.internal_error",
        error instanceof Error ? error.message : undefined,
      );
      return rpcError(
        request.id,
        JSONRPCErrorCodes.internalError,
        "Internal error",
        "stagehand.internal_error",
      );
    } finally {
      span.end();
      if (shutdownAfterResponse) await tracing.shutdown();
    }
  };
}

// JSON-RPC errors are normal responses, so OpenTelemetry cannot infer span failure automatically.
function setRpcErrorOnSpan(span: Span, code: number, type: string, message?: string): void {
  span.setAttribute("rpc.response.status_code", String(code));
  span.setAttribute("error.type", type);
  span.setStatus({ code: SpanStatusCode.ERROR, ...(message ? { message } : {}) });
}

function rpcError(id: number | null, code: number, message: string, type: string): JSONRPCResponse {
  return JSONRPCErrorResponseSchema.parse({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data: { type },
    },
  });
}

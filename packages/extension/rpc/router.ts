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

export type StagehandHandlers = {
  [Method in keyof typeof StagehandMethods]: (
    params: z.output<(typeof StagehandMethods)[Method]["paramsSchema"]>,
  ) => Promise<z.output<(typeof StagehandMethods)[Method]["resultSchema"]>>;
};

export function createStagehandRouter(routes: StagehandHandlers) {
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

    try {
      const result = await route(request.params);
      const resultResult = definition.resultSchema.safeParse(result);

      if (!resultResult.success) {
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
        return rpcError(request.id, error.code, error.message, error.type);
      }

      return rpcError(
        request.id,
        JSONRPCErrorCodes.internalError,
        "Internal error",
        "stagehand.internal_error",
      );
    }
  };
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

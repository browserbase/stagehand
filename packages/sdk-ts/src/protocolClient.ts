import type { z } from "zod/v4";
import { JSONRPCResponseSchema } from "../../protocol/json-rpc/schemas.js";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";

export type StagehandMethod = keyof typeof StagehandMethods;
export type StagehandProtocolRequest = z.output<typeof StagehandRpcRequestSchema>;

type StagehandMethodDefinition<Method extends StagehandMethod> = (typeof StagehandMethods)[Method];

export type StagehandMethodParams<Method extends StagehandMethod> = z.output<
  StagehandMethodDefinition<Method>["paramsSchema"]
>;

export type StagehandMethodResult<Method extends StagehandMethod> = z.output<
  StagehandMethodDefinition<Method>["resultSchema"]
>;

export type StagehandProtocolClient = {
  send(request: StagehandProtocolRequest): Promise<unknown>;
};

export function buildStagehandProtocolRequest<Method extends StagehandMethod>(
  method: Method,
  params: StagehandMethodParams<Method>,
): Extract<StagehandProtocolRequest, { method: Method }> {
  const parsedRequest = StagehandRpcRequestSchema.safeParse({
    jsonrpc: "2.0",
    id: 0,
    method,
    params,
  });

  if (!parsedRequest.success) {
    throw parsedRequest.error;
  }

  return parsedRequest.data as Extract<StagehandProtocolRequest, { method: Method }>;
}

export function parseStagehandProtocolResponse<Method extends StagehandMethod>(
  method: Method,
  response: unknown,
): StagehandMethodResult<Method> {
  const parsedResponse = JSONRPCResponseSchema.safeParse(response);

  if (!parsedResponse.success) {
    throw parsedResponse.error;
  }

  if ("error" in parsedResponse.data) {
    throw new Error(parsedResponse.data.error.message);
  }

  const definition = StagehandMethods[method];
  const parsedResult = definition.resultSchema.safeParse(parsedResponse.data.result);

  if (!parsedResult.success) {
    throw parsedResult.error;
  }

  return parsedResult.data as StagehandMethodResult<Method>;
}

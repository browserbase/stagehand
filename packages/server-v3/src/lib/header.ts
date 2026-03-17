import type { FastifyRequest } from "fastify";

import { MissingHeaderError } from "../types/error.js";

export const dangerouslyGetHeader = (
  request: FastifyRequest,
  header: string,
): string => {
  const headerValue = request.headers[header];

  if (!headerValue) {
    throw new MissingHeaderError(header);
  }
  if (Array.isArray(headerValue)) {
    const [value] = headerValue;
    if (!value) {
      throw new MissingHeaderError(header);
    }
    return value;
  }
  return headerValue;
};

export const getOptionalHeader = (
  request: FastifyRequest,
  header: string,
): string | undefined => {
  const headerValue = request.headers[header];
  if (!headerValue) {
    return undefined;
  }
  if (Array.isArray(headerValue)) {
    const [value] = headerValue;
    if (!value) {
      return undefined;
    }
    return value;
  }
  return headerValue;
};

export function getRequestModelConfig(
  request: FastifyRequest,
): Record<string, unknown> | undefined {
  const body = request.body as Record<string, unknown> | undefined;
  const options = body?.options as Record<string, unknown> | undefined;
  const model = options?.model as Record<string, unknown> | undefined;

  if (model && typeof model === "object") {
    return model;
  }

  const modelClientOptions = body?.modelClientOptions as
    | Record<string, unknown>
    | undefined;
  const modelName =
    typeof body?.modelName === "string" ? body.modelName : undefined;

  if (!modelClientOptions && !modelName) {
    return undefined;
  }

  return {
    ...(modelClientOptions ?? {}),
    ...(modelName ? { modelName } : {}),
  };
}

/**
 * Extracts model name from request body, supporting V3 structure.
 * - V3: body.options.model.modelName
 */
export function getModelName(request: FastifyRequest): string | undefined {
  const modelConfig = getRequestModelConfig(request);
  if (typeof modelConfig?.modelName === "string" && modelConfig.modelName) {
    return modelConfig.modelName;
  }
  return undefined;
}

/**
 * Extracts the model API key with precedence:
 * 1. Per-request body apiKey (V3: body.options.model.apiKey)
 * 2. Per-request header x-model-api-key
 */
export function getModelApiKey(request: FastifyRequest): string | undefined {
  const modelConfig = getRequestModelConfig(request);
  if (typeof modelConfig?.apiKey === "string" && modelConfig.apiKey) {
    return modelConfig.apiKey;
  }

  return getOptionalHeader(request, "x-model-api-key");
}

/**
 * Extracts the stream response value from either the request header or body.
 * Body parameter takes precedence over header.
 * Defaults to false (non-streaming) if neither is provided.
 */
export function shouldRespondWithSSE(request: FastifyRequest): boolean {
  const body = request.body as Record<string, unknown> | undefined;
  if (typeof body?.streamResponse === "boolean") {
    return body.streamResponse;
  }
  if (typeof body?.streamResponse === "string") {
    return body.streamResponse.toLowerCase() === "true";
  }

  const streamHeader = getOptionalHeader(request, "x-stream-response");
  if (streamHeader) {
    return streamHeader.toLowerCase() === "true";
  }

  return false;
}

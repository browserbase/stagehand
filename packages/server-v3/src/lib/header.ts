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

function normalizeRequestModelConfig(
  model: unknown,
): Record<string, unknown> | undefined {
  if (typeof model === "string" && model) {
    return { modelName: model };
  }

  if (model && typeof model === "object" && !Array.isArray(model)) {
    return model as Record<string, unknown>;
  }

  return undefined;
}

export function getRequestModelConfigFromBody(
  body: unknown,
): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const record = body as Record<string, unknown>;
  const options = record.options as Record<string, unknown> | undefined;
  const optionsModel = normalizeRequestModelConfig(options?.model);

  if (optionsModel) {
    return optionsModel;
  }

  const agentConfig = record.agentConfig as Record<string, unknown> | undefined;
  const agentModel = normalizeRequestModelConfig(agentConfig?.model);

  if (agentModel) {
    return agentModel;
  }

  const modelClientOptions = record.modelClientOptions as
    | Record<string, unknown>
    | undefined;
  const modelName =
    typeof record.modelName === "string" ? record.modelName : undefined;

  if (!modelClientOptions && !modelName) {
    return undefined;
  }

  return {
    ...(modelClientOptions ?? {}),
    ...(modelName ? { modelName } : {}),
  };
}

export function getRequestModelConfig(
  request: FastifyRequest,
): Record<string, unknown> | undefined {
  return getRequestModelConfigFromBody(request.body);
}

/**
 * Extracts model name from a request body or parsed payload, supporting V3
 * structures like body.options.model, body.agentConfig.model, and
 * /sessions/start modelClientOptions.
 */
export function getModelName(
  request: FastifyRequest,
  body?: unknown,
): string | undefined {
  const modelConfig =
    body === undefined
      ? getRequestModelConfig(request)
      : getRequestModelConfigFromBody(body);
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
export function getModelApiKey(
  request: FastifyRequest,
  body?: unknown,
): string | undefined {
  const modelConfig =
    body === undefined
      ? getRequestModelConfig(request)
      : getRequestModelConfigFromBody(body);
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

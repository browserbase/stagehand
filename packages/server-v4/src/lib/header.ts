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

/**
 * Extracts model name from request body, supporting V3 structure.
 * - V3: body.options.model.modelName
 */
export function getModelName(request: FastifyRequest): string | undefined {
  const body = request.body as Record<string, unknown> | undefined;
  const options = body?.options as Record<string, unknown> | undefined;
  const model = options?.model as Record<string, unknown> | undefined;

  if (typeof model?.modelName === "string" && model.modelName) {
    return model.modelName;
  }

  if (typeof body?.modelName === "string" && body.modelName) {
    return body.modelName;
  }

  return undefined;
}

/**
 * Extracts the model API key with precedence:
 * 1. Per-request body apiKey (V3: body.options.model.apiKey)
 * 2. Per-request header x-model-api-key
 */
export function getModelApiKey(request: FastifyRequest): string | undefined {
  const body = request.body as Record<string, unknown> | undefined;
  const options = body?.options as Record<string, unknown> | undefined;
  const model = options?.model as Record<string, unknown> | undefined;

  if (typeof model?.apiKey === "string" && model.apiKey) {
    return model.apiKey;
  }

  return getOptionalHeader(request, "x-model-api-key");
}

import type { FastifyRequest } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

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

const requestModelSchema = z.union([Api.ModelConfigSchema, z.string()]);
const requestModelCarrierSchema = z
  .object({
    model: requestModelSchema.optional(),
  })
  .passthrough();
const requestModelEnvelopeSchema = z
  .object({
    options: requestModelCarrierSchema.optional(),
    agentConfig: requestModelCarrierSchema.optional(),
    modelName: z.string().optional(),
  })
  .passthrough();
const requestModelConfigSchema = z
  .object({
    model: Api.ModelConfigSchema.optional(),
    modelName: z.string().optional(),
    apiKey: z.string().optional(),
  })
  .strict();

export type RequestModelConfig = z.infer<typeof requestModelConfigSchema>;

const getNonEmptyString = (value?: string): string | undefined =>
  value ? value : undefined;

const normalizeModel = (
  model: z.infer<typeof requestModelSchema> | undefined,
): Api.ModelConfig | undefined =>
  typeof model === "string" ? { modelName: model } : model;

/**
 * Extracts model config from request body.
 *
 * V3:
 * - act/observe/extract: body.options.model
 */
export function getRequestModelConfig(
  request: FastifyRequest,
): RequestModelConfig {
  const body = requestModelEnvelopeSchema.parse(request.body ?? {});
  const model = normalizeModel(body.options?.model);

  return requestModelConfigSchema.parse({
    model,
    modelName: getNonEmptyString(model?.modelName) ?? body.modelName,
    apiKey:
      getNonEmptyString(model?.apiKey) ??
      getOptionalHeader(request, "x-model-api-key"),
  });
}

/**
 * Extracts the structured model config that can be used to initialize a
 * Stagehand session for this request. Unlike getRequestModelConfig, this may
 * read agentConfig.model, but it does not promote agent model credentials to
 * the request-level API key.
 */
export function getSessionBootstrapModelConfig(
  request: FastifyRequest,
): RequestModelConfig {
  const requestModelConfig = getRequestModelConfig(request);
  if (requestModelConfig.model) {
    return requestModelConfig;
  }

  const body = requestModelEnvelopeSchema.parse(request.body ?? {});
  const agentModel = normalizeModel(body.agentConfig?.model);

  return requestModelConfigSchema.parse({
    model: agentModel,
    modelName:
      getNonEmptyString(agentModel?.modelName) ?? requestModelConfig.modelName,
    apiKey: requestModelConfig.apiKey,
  });
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

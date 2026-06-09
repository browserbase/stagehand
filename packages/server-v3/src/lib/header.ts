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

const emptyStringSchema = z.literal("").transform((): undefined => undefined);
const requiredStringSchema = z.string().min(1);
const optionalStringSchema = z
  .union([emptyStringSchema, z.string()])
  .optional();

const requestModelInputSchema = z
  .union([
    emptyStringSchema,
    requiredStringSchema.transform(
      (modelName): Api.ModelConfig => ({ modelName }),
    ),
    Api.ModelConfigSchema,
  ])
  .optional();
const requestModelCarrierSchema = z
  .object({
    model: requestModelInputSchema,
  })
  .passthrough();
const unparsedModelCarrierSchema = z
  .object({
    model: z.unknown().optional(),
  })
  .passthrough();
const requestModelEnvelopeSchema = z
  .object({
    options: requestModelCarrierSchema.optional(),
    agentConfig: unparsedModelCarrierSchema.optional(),
    modelName: optionalStringSchema,
  })
  .passthrough();
const stagehandInitModelEnvelopeSchema = z
  .object({
    options: requestModelCarrierSchema.optional(),
    agentConfig: requestModelCarrierSchema.optional(),
    modelName: optionalStringSchema,
  })
  .passthrough();
const requestModelConfigSchema = z
  .object({
    model: Api.ModelConfigSchema.optional(),
    modelName: optionalStringSchema,
    apiKey: optionalStringSchema,
  })
  .strict();

export type RequestModelConfig = z.infer<typeof requestModelConfigSchema>;
type RequestModelConfigResult =
  | { success: true; data: RequestModelConfig }
  | { success: false; error: z.ZodError };

/**
 * Extracts request-level model config with precedence.
 *
 * Model name:
 * 1. body.options.model.modelName or body.options.model string
 * 2. Legacy body.modelName fallback
 *
 * API key:
 * 1. body.options.model.apiKey
 * 2. x-model-api-key header
 *
 * agentConfig.model is parsed separately for Stagehand initialization. Its
 * credentials are scoped to the agent main model and must not become the
 * request-level API key fallback used by action/execution models.
 */
export function getRequestModelConfig(
  request: FastifyRequest,
): RequestModelConfigResult {
  const bodyResult = requestModelEnvelopeSchema.safeParse(request.body ?? {});
  if (!bodyResult.success) {
    return bodyResult;
  }

  const body = bodyResult.data;
  const model = body.options?.model;
  const modelApiKey = model && "apiKey" in model ? model.apiKey : undefined;
  const configResult = requestModelConfigSchema.safeParse({
    model,
    modelName: model?.modelName ?? body.modelName,
    apiKey: modelApiKey ?? getOptionalHeader(request, "x-model-api-key"),
  });
  if (!configResult.success) {
    return configResult;
  }

  return configResult;
}

/**
 * Extracts the structured model config used when creating a Stagehand instance
 * for this request. This can read agentConfig.model for agentExecute startup,
 * but it does not promote agent model credentials to the request-level API key.
 */
export function getStagehandInitModelConfig(
  request: FastifyRequest,
  requestModelConfig?: RequestModelConfig,
): RequestModelConfigResult {
  const baseConfigResult = requestModelConfig
    ? requestModelConfigSchema.safeParse(requestModelConfig)
    : getRequestModelConfig(request);
  if (!baseConfigResult.success) {
    return baseConfigResult;
  }

  const baseConfig = baseConfigResult.data;
  if (baseConfig.model) {
    return baseConfigResult;
  }

  const bodyResult = stagehandInitModelEnvelopeSchema.safeParse(
    request.body ?? {},
  );
  if (!bodyResult.success) {
    return bodyResult;
  }

  const agentModel = bodyResult.data.agentConfig?.model;
  const configResult = requestModelConfigSchema.safeParse({
    model: agentModel,
    modelName: agentModel?.modelName ?? baseConfig.modelName,
    apiKey: baseConfig.apiKey,
  });
  if (!configResult.success) {
    return configResult;
  }

  return configResult;
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

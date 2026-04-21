import type { RouteOptions } from "fastify";
import { ResponseSerializationError } from "fastify-zod-openapi";
import { StatusCodes } from "http-status-codes";

type TaggedRouteSchema = NonNullable<RouteOptions["schema"]> & {
  tags?: string[];
};

type ValidationLikeError = {
  validation: unknown[];
};

function isValidationLikeError(error: unknown): error is ValidationLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    "validation" in error &&
    Array.isArray((error as { validation?: unknown }).validation)
  );
}

function getErrorStatusCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  return StatusCodes.INTERNAL_SERVER_ERROR;
}

export function withTag(route: RouteOptions, tag: string): RouteOptions {
  if (!route.schema) {
    return route;
  }

  const schema = route.schema as TaggedRouteSchema;
  const tags = schema.tags ?? [];

  return {
    ...route,
    schema: {
      ...schema,
      tags: tags.includes(tag) ? tags : [...tags, tag],
    },
  };
}

export function normalizePluginError(error: unknown): {
  errorMessage: string;
  stack: string | null;
  statusCode: number;
} {
  if (isValidationLikeError(error)) {
    return {
      errorMessage: "Request validation failed",
      stack: null,
      statusCode: StatusCodes.BAD_REQUEST,
    };
  }

  if (error instanceof ResponseSerializationError) {
    return {
      errorMessage: "Response validation failed",
      stack: error.stack ?? null,
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    };
  }

  const normalizedError =
    error instanceof Error ? error : new Error(String(error));

  return {
    errorMessage: normalizedError.message,
    stack: normalizedError.stack ?? null,
    statusCode: getErrorStatusCode(error),
  };
}

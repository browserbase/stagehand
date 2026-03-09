import type { FastifyRequest, RouteHandlerMethod } from "fastify";
import { StatusCodes } from "http-status-codes";

import { withErrorHandling } from "../../../lib/errorHandler.js";
import { buildErrorResponse } from "../../../schemas/v4/page.js";

function getString(
  value: unknown,
  key: string,
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const field = record[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function getPageId(request: FastifyRequest): string | undefined {
  const body = request.body;
  const query = request.query;

  if (body && typeof body === "object") {
    const params = (body as { params?: unknown }).params;
    const pageId = getString(params, "pageId");
    if (pageId) {
      return pageId;
    }
  }

  return getString(query, "pageId");
}

function getSessionId(request: FastifyRequest): string | undefined {
  return (
    getString(request.body, "sessionId") ?? getString(request.query, "sessionId")
  );
}

function getRequestId(request: FastifyRequest): string {
  return getString(request.body, "id") ?? getString(request.query, "id") ?? request.id;
}

function getActionId(request: FastifyRequest): string | undefined {
  return getString(request.params, "actionId");
}

export function createNotImplementedHandler(message: string): RouteHandlerMethod {
  return withErrorHandling(async (request, reply) => {
    return reply.status(StatusCodes.NOT_IMPLEMENTED).send(
      buildErrorResponse({
        id: getRequestId(request),
        error: {
          code: "not_implemented",
          message,
        },
        metadata: {
          requestId: request.id,
          sessionId: getSessionId(request),
          pageId: getPageId(request),
          actionId: getActionId(request),
        },
      }),
    );
  });
}

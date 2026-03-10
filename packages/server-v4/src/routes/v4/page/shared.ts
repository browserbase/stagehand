import { randomUUID } from "node:crypto";

import type { RouteHandlerMethod } from "fastify";
import type { V3 } from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";

import { authMiddleware } from "../../../lib/auth.js";
import { getModelApiKey } from "../../../lib/header.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import {
  buildErrorResponse,
  type PageAction,
  type PageActionDetailsQuery,
  type PageActionListQuery,
  type PageActionMethod,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";

export const pageErrorResponses = {
  400: V4ErrorResponseSchema,
  401: V4ErrorResponseSchema,
  404: V4ErrorResponseSchema,
  408: V4ErrorResponseSchema,
  422: V4ErrorResponseSchema,
  500: V4ErrorResponseSchema,
};

type PageRequestBody<TAction extends PageAction> = {
  sessionId: string;
  params: TAction["params"];
};

type PageActionHandlerContext<TAction extends PageAction> = {
  page: Awaited<ReturnType<typeof resolvePage>>;
  params: TAction["params"];
  request: Parameters<RouteHandlerMethod>[0];
  sessionId: string;
};

// Selector stays wrapped in an object even though we only consume xpath today,
// because we may add more optional locator fields later without changing the
// v4 request shape.
function normalizeXPath(xpath: string): string {
  return xpath.startsWith("xpath=") || xpath.startsWith("/")
    ? xpath
    : `xpath=${xpath}`;
}

function getStatusCode(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (
    message === "Unauthorized" ||
    message === "Session not found" ||
    message === "Page not found" ||
    message === "CDP params must be an object"
  ) {
    if (message === "Unauthorized") {
      return StatusCodes.UNAUTHORIZED;
    }

    if (message === "CDP params must be an object") {
      return StatusCodes.BAD_REQUEST;
    }

    return StatusCodes.NOT_FOUND;
  }

  if (
    message.startsWith("Session not found:") ||
    message.startsWith("Session expired:") ||
    message.startsWith("Action not found:")
  ) {
    return StatusCodes.NOT_FOUND;
  }

  if (name === "StagehandElementNotFoundError") {
    return StatusCodes.NOT_FOUND;
  }

  if (name === "ElementNotVisibleError") {
    return StatusCodes.UNPROCESSABLE_ENTITY;
  }

  if (name === "TimeoutError" || name.endsWith("TimeoutError")) {
    return StatusCodes.REQUEST_TIMEOUT;
  }

  if (
    name === "StagehandInvalidArgumentError" ||
    name === "StagehandMissingArgumentError" ||
    name === "StagehandEvalError" ||
    name === "StagehandLocatorError"
  ) {
    return StatusCodes.BAD_REQUEST;
  }

  return StatusCodes.INTERNAL_SERVER_ERROR;
}

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (
    error.message.startsWith("Session not found:") ||
    error.message.startsWith("Session expired:")
  ) {
    return "Session not found";
  }

  return error.message;
}

async function resolvePage(stagehand: V3, pageId?: string) {
  if (!pageId) {
    return await stagehand.context.awaitActivePage();
  }

  const page = stagehand
    .context
    .pages()
    .find((candidate) => candidate.targetId() === pageId);

  if (!page) {
    throw new Error("Page not found");
  }

  stagehand.context.setActivePage(page);
  return page;
}

export function createPageActionHandler<
  TAction extends PageAction,
>({
  actionSchema,
  execute,
  method,
}: {
  actionSchema: z.ZodType<TAction>;
  execute: (ctx: PageActionHandlerContext<TAction>) => Promise<TAction["result"]>;
  method: PageActionMethod;
}): RouteHandlerMethod {
  return async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send(
          buildErrorResponse({
            error: "Unauthorized",
            statusCode: StatusCodes.UNAUTHORIZED,
          }),
        );
    }

    const { params, sessionId } = request.body as PageRequestBody<TAction>;
    const sessionStore = getSessionStore();

    try {
      const stagehand = await sessionStore.getOrCreateStagehand(sessionId, {
        modelApiKey: getModelApiKey(request),
      });
      const page = await resolvePage(stagehand, params.pageId);
      const pageId = page.targetId();
      const createdAt = new Date().toISOString();

      let action = actionSchema.parse({
        id: randomUUID(),
        method,
        status: "running",
        sessionId,
        pageId,
        createdAt,
        updatedAt: createdAt,
        error: null,
        params,
        result: null,
      });

      await sessionStore.putPageAction(action);

      try {
        const result = await execute({ page, params, request, sessionId });
        const completedAt = new Date().toISOString();

        action = actionSchema.parse({
          ...action,
          status: "completed",
          updatedAt: completedAt,
          completedAt,
          error: null,
          result,
        });

        await sessionStore.putPageAction(action);
        return reply.status(StatusCodes.OK).send({
          success: true,
          error: null,
          action,
        });
      } catch (error) {
        const statusCode = getStatusCode(error);
        const message = getErrorMessage(error);
        const completedAt = new Date().toISOString();

        action = actionSchema.parse({
          ...action,
          status: "failed",
          updatedAt: completedAt,
          completedAt,
          error: message,
          result: null,
        });

        await sessionStore.putPageAction(action);
        return reply
          .status(statusCode)
          .send(
            buildErrorResponse({
              error: message,
              statusCode,
              stack: error instanceof Error ? (error.stack ?? null) : null,
              action,
            }),
          );
      }
    } catch (error) {
      const statusCode = getStatusCode(error);
      return reply.status(statusCode).send(
        buildErrorResponse({
          error: getErrorMessage(error),
          statusCode,
          stack: error instanceof Error ? (error.stack ?? null) : null,
        }),
      );
    }
  };
}

export const pageActionDetailsHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  if (!(await authMiddleware(request))) {
    return reply
      .status(StatusCodes.UNAUTHORIZED)
      .send(
        buildErrorResponse({
          error: "Unauthorized",
          statusCode: StatusCodes.UNAUTHORIZED,
        }),
      );
  }

  const { actionId } = request.params as { actionId: string };
  const { sessionId } = request.query as PageActionDetailsQuery;
  const sessionStore = getSessionStore();

  const action = await sessionStore.getPageAction(actionId);
  if (!action || action.sessionId !== sessionId) {
    return reply
      .status(StatusCodes.NOT_FOUND)
      .send(
        buildErrorResponse({
          error: `Action not found: ${actionId}`,
          statusCode: StatusCodes.NOT_FOUND,
        }),
      );
  }

  return reply.status(StatusCodes.OK).send({
    success: true,
    error: null,
    action,
  });
};

export const pageActionListHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  if (!(await authMiddleware(request))) {
    return reply
      .status(StatusCodes.UNAUTHORIZED)
      .send(
        buildErrorResponse({
          error: "Unauthorized",
          statusCode: StatusCodes.UNAUTHORIZED,
        }),
      );
  }

  const query = request.query as PageActionListQuery;
  const actions = await getSessionStore().listPageActions(query);

  return reply.status(StatusCodes.OK).send({
    success: true,
    error: null,
    actions,
  });
};

export { normalizeXPath };

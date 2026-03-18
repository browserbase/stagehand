import { randomUUID } from "node:crypto";

import type { RouteHandlerMethod } from "fastify";
import type { V3 } from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";

import { authMiddleware } from "../../../lib/auth.js";
import { getModelApiKey } from "../../../lib/header.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import type {
  CreateSessionParams,
  SessionStore,
} from "../../../lib/SessionStore.js";
import {
  buildBrowserSessionErrorResponse,
  type BrowserSession,
  type BrowserSessionAction,
  type BrowserSessionActionDetailsQuery,
  type BrowserSessionActionListQuery,
  type BrowserSessionActionMethod,
  type BrowserSessionPage,
  BrowserSessionV4ErrorResponseSchema,
} from "../../../schemas/v4/browserSession.js";

export function buildBrowserSession(input: {
  id: string;
  params: CreateSessionParams;
  status: "running" | "ended";
  available: boolean;
  cdpUrl?: string | null;
}): BrowserSession {
  return {
    id: input.id,
    env: input.params.browserType === "local" ? "LOCAL" : "BROWSERBASE",
    status: input.status,
    modelName: input.params.modelName,
    cdpUrl: input.cdpUrl ?? input.params.connectUrl ?? "",
    available: input.available,
    browserbaseSessionId: input.params.browserbaseSessionID,
    browserbaseSessionCreateParams:
      input.params.browserbaseSessionCreateParams as BrowserSession["browserbaseSessionCreateParams"],
    localBrowserLaunchOptions: input.params.localBrowserLaunchOptions,
    domSettleTimeoutMs: input.params.domSettleTimeoutMs,
    verbose: input.params.verbose,
    systemPrompt: input.params.systemPrompt,
    selfHeal: input.params.selfHeal,
    waitForCaptchaSolves: input.params.waitForCaptchaSolves,
    experimental: input.params.experimental,
    actTimeoutMs: input.params.actTimeoutMs,
  };
}

export const browserSessionActionErrorResponses = {
  400: BrowserSessionV4ErrorResponseSchema,
  401: BrowserSessionV4ErrorResponseSchema,
  404: BrowserSessionV4ErrorResponseSchema,
  408: BrowserSessionV4ErrorResponseSchema,
  422: BrowserSessionV4ErrorResponseSchema,
  500: BrowserSessionV4ErrorResponseSchema,
};

type BrowserSessionRequestBody<TAction extends BrowserSessionAction> = {
  sessionId: string;
  params: TAction["params"];
};

type BrowserSessionActionHandlerContext<TAction extends BrowserSessionAction> = {
  stagehand: V3;
  params: TAction["params"];
  request: Parameters<RouteHandlerMethod>[0];
  sessionId: string;
  sessionStore: SessionStore;
};

type BrowserSessionActionExecutionResult<TAction extends BrowserSessionAction> = {
  result: TAction["result"];
  pageId?: string;
};

function getStatusCode(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (
    message === "Unauthorized" ||
    message.startsWith("Session not found:") ||
    message.startsWith("Session expired:") ||
    message.startsWith("Action not found:")
  ) {
    return message === "Unauthorized"
      ? StatusCodes.UNAUTHORIZED
      : StatusCodes.NOT_FOUND;
  }

  if (name === "PageNotFoundError") {
    return StatusCodes.NOT_FOUND;
  }

  if (name === "TimeoutError" || name.endsWith("TimeoutError")) {
    return StatusCodes.REQUEST_TIMEOUT;
  }

  if (
    name === "CookieSetError" ||
    name === "CookieValidationError" ||
    name === "StagehandSetExtraHTTPHeadersError" ||
    name === "StagehandInvalidArgumentError" ||
    name === "StagehandMissingArgumentError"
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
    return "Browser session not found";
  }

  return error.message;
}

export function buildBrowserSessionPage(page: {
  mainFrameId(): string;
  targetId(): string;
  url(): string;
}): BrowserSessionPage {
  const targetId = page.targetId();
  return {
    pageId: targetId,
    targetId,
    mainFrameId: page.mainFrameId(),
    url: page.url(),
  };
}

function getInitialPageId(params: unknown): string | undefined {
  if (
    typeof params === "object" &&
    params !== null &&
    "pageId" in params &&
    typeof (params as { pageId?: unknown }).pageId === "string"
  ) {
    return (params as { pageId: string }).pageId;
  }

  return undefined;
}

export function toStringOrRegExp(
  value?:
    | string
    | {
        source: string;
        flags?: string;
      },
): string | RegExp | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return new RegExp(value.source, value.flags);
}

export function createBrowserSessionActionHandler<
  TAction extends BrowserSessionAction,
>({
  actionSchema,
  execute,
  method,
}: {
  actionSchema: z.ZodType<TAction>;
  execute: (
    ctx: BrowserSessionActionHandlerContext<TAction>,
  ) => Promise<BrowserSessionActionExecutionResult<TAction>>;
  method: BrowserSessionActionMethod;
}): RouteHandlerMethod {
  return async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send(
          buildBrowserSessionErrorResponse({
            error: "Unauthorized",
            statusCode: StatusCodes.UNAUTHORIZED,
          }),
        );
    }

    const { params, sessionId } = request.body as BrowserSessionRequestBody<TAction>;
    const sessionStore = getSessionStore();

    try {
      const stagehand = await sessionStore.getOrCreateStagehand(sessionId, {
        modelApiKey: getModelApiKey(request),
      });
      const createdAt = new Date().toISOString();

      let action = actionSchema.parse({
        id: randomUUID(),
        method,
        status: "running",
        sessionId,
        pageId: getInitialPageId(params),
        createdAt,
        updatedAt: createdAt,
        error: null,
        params,
        result: null,
      });

      await sessionStore.putBrowserSessionAction(action);

      try {
        const executed = await execute({
          stagehand,
          params,
          request,
          sessionId,
          sessionStore,
        });
        const completedAt = new Date().toISOString();

        action = actionSchema.parse({
          ...action,
          status: "completed",
          updatedAt: completedAt,
          completedAt,
          error: null,
          pageId: executed.pageId ?? action.pageId,
          result: executed.result,
        });

        await sessionStore.putBrowserSessionAction(action);
        return reply.status(StatusCodes.OK).send({
          success: true,
          error: null,
          action,
        });
      } catch (error) {
        const statusCode = getStatusCode(error);
        const completedAt = new Date().toISOString();

        action = actionSchema.parse({
          ...action,
          status: "failed",
          updatedAt: completedAt,
          completedAt,
          error: getErrorMessage(error),
          result: null,
        });

        await sessionStore.putBrowserSessionAction(action);
        return reply
          .status(statusCode)
          .send(
            buildBrowserSessionErrorResponse({
              error: getErrorMessage(error),
              statusCode,
              stack: error instanceof Error ? (error.stack ?? null) : null,
              action,
            }),
          );
      }
    } catch (error) {
      const statusCode = getStatusCode(error);
      return reply
        .status(statusCode)
        .send(
          buildBrowserSessionErrorResponse({
            error: getErrorMessage(error),
            statusCode,
            stack: error instanceof Error ? (error.stack ?? null) : null,
          }),
        );
    }
  };
}

export const browserSessionActionDetailsHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  if (!(await authMiddleware(request))) {
    return reply
      .status(StatusCodes.UNAUTHORIZED)
      .send(
        buildBrowserSessionErrorResponse({
          error: "Unauthorized",
          statusCode: StatusCodes.UNAUTHORIZED,
        }),
      );
  }

  const { actionId } = request.params as { actionId: string };
  const { sessionId } = request.query as BrowserSessionActionDetailsQuery;
  const sessionStore = getSessionStore();
  const action = await sessionStore.getBrowserSessionAction(actionId);

  if (!action || action.sessionId !== sessionId) {
    return reply
      .status(StatusCodes.NOT_FOUND)
      .send(
        buildBrowserSessionErrorResponse({
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

export const browserSessionActionListHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  if (!(await authMiddleware(request))) {
    return reply
      .status(StatusCodes.UNAUTHORIZED)
      .send(
        buildBrowserSessionErrorResponse({
          error: "Unauthorized",
          statusCode: StatusCodes.UNAUTHORIZED,
        }),
      );
  }

  const query = request.query as BrowserSessionActionListQuery;
  const actions = await getSessionStore().listBrowserSessionActions(query);

  return reply.status(StatusCodes.OK).send({
    success: true,
    error: null,
    actions,
  });
};

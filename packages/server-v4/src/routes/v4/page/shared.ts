import { randomUUID } from "node:crypto";

import type { RouteHandlerMethod } from "fastify";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";

import {
  type PageAction,
  PageActionSchema,
  type PageActionDetailsQuery,
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

type PageRequestQuery<TAction extends PageAction> = {
  id?: string;
  sessionId: string;
} & TAction["params"];

type PageActionHandlerContext<TAction extends PageAction> = {
  page: any;
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

function getPageId(params: unknown): string | undefined {
  if (
    typeof params === "object" &&
    params !== null &&
    "pageId" in params &&
    typeof (params as { pageId?: unknown }).pageId === "string"
  ) {
    return (params as { pageId: string }).pageId;
  }

  return "page_stub";
}

export function createPageActionHandler<TAction extends PageAction>({
  actionSchema,
  execute: _execute,
  method,
}: {
  actionSchema: z.ZodType<TAction>;
  execute: (
    ctx: PageActionHandlerContext<TAction>,
  ) => Promise<TAction["result"]>;
  method: PageActionMethod;
}): RouteHandlerMethod {
  return async (request, reply) => {
    const input = (request.body ?? request.query) as
      | PageRequestBody<TAction>
      | PageRequestQuery<TAction>;
    const sessionId = input.sessionId ?? "session_stub";
    const params = (
      "params" in input ? input.params : input
    ) as TAction["params"];
    const createdAt = new Date().toISOString();
    const action = actionSchema.parse({
      id: "id" in input ? (input.id ?? randomUUID()) : randomUUID(),
      method,
      status: "completed",
      sessionId,
      pageId: getPageId(params),
      createdAt,
      updatedAt: createdAt,
      completedAt: createdAt,
      error: null,
      params,
      result: null,
    });

    return reply.status(StatusCodes.OK).send({
      success: true,
      error: null,
      action,
    });
  };
}

export const pageActionDetailsHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  const { actionId } = request.params as { actionId: string };
  const { sessionId } = request.query as PageActionDetailsQuery;
  const createdAt = new Date().toISOString();
  const action = PageActionSchema.parse({
    id: actionId,
    method: "title",
    status: "completed",
    sessionId,
    pageId: "page_stub",
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    error: null,
    params: {},
    result: null,
  });

  return reply.status(StatusCodes.OK).send({
    success: true,
    error: null,
    action,
  });
};

export const pageActionListHandler: RouteHandlerMethod = async (
  _request,
  reply,
) => {
  return reply.status(StatusCodes.OK).send({
    success: true,
    error: null,
    actions: [] as PageAction[],
  });
};

export { normalizeXPath };

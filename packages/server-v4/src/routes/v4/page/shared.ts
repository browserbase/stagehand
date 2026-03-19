import { randomUUID } from "node:crypto";

import type { RouteHandlerMethod } from "fastify";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";

import {
  type PageAction,
  PageTitleActionSchema,
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

export function getPageId(params: unknown): string | undefined {
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

export function buildStubPageFrame(pageId = "page_stub") {
  return {
    frameId: "frame_stub",
    pageId,
    sessionId: "cdp-session_stub",
    isBrowserRemote: false,
  };
}

export function buildStubNavigationResult(url = "https://stub.invalid") {
  return {
    url,
    response: {
      url,
      status: 200,
      statusText: "OK",
      ok: true,
      headers: {},
    },
  };
}

function extractPageParams<TAction extends PageAction>(
  input: PageRequestBody<TAction> | PageRequestQuery<TAction>,
): TAction["params"] {
  if ("params" in input) {
    return input.params;
  }

  const params = { ...input };
  delete (params as { id?: string }).id;
  delete (params as { sessionId?: string }).sessionId;
  return params as TAction["params"];
}

export function createPageActionHandler<TAction extends PageAction>(options: {
  actionSchema: z.ZodType<TAction>;
  execute: (
    ctx: PageActionHandlerContext<TAction>,
  ) => Promise<TAction["result"]>;
  method: PageActionMethod;
}): RouteHandlerMethod {
  const { actionSchema, method } = options;

  return async (request, reply) => {
    const input = (request.body ?? request.query) as
      | PageRequestBody<TAction>
      | PageRequestQuery<TAction>;
    const sessionId = input.sessionId ?? "session_stub";
    const params = extractPageParams(input);
    const result = await options.execute({
      params,
      request,
      sessionId,
    });
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
      result,
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
  const action = PageTitleActionSchema.parse({
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
    result: { title: "Stub title" },
  });

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
  const { sessionId } = request.query as PageActionDetailsQuery;
  const createdAt = new Date().toISOString();
  return reply.status(StatusCodes.OK).send({
    success: true,
    error: null,
    actions: [
      PageTitleActionSchema.parse({
        id: randomUUID(),
        method: "title",
        status: "completed",
        sessionId,
        pageId: "page_stub",
        createdAt,
        updatedAt: createdAt,
        completedAt: createdAt,
        error: null,
        params: {},
        result: { title: "Stub title" },
      }),
    ] as PageAction[],
  });
};

export { normalizeXPath };

import { randomUUID } from "node:crypto";

import type { RouteHandlerMethod } from "fastify";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";

import {
  type BrowserSession,
  type BrowserSessionAction,
  BrowserSessionActionSchema,
  type BrowserSessionActionDetailsQuery,
  type BrowserSessionActionMethod,
  type BrowserSessionPage,
  BrowserSessionSchema,
  BrowserSessionV4ErrorResponseSchema,
} from "../../../schemas/v4/browserSession.js";

export function buildBrowserSession(input: {
  id: string;
  env: BrowserSession["env"];
  status: "running" | "ended";
  available: boolean;
  modelName: string;
  cdpUrl?: string | null;
  browserbaseSessionId?: string;
  browserbaseSessionCreateParams?: BrowserSession["browserbaseSessionCreateParams"];
  localBrowserLaunchOptions?: BrowserSession["localBrowserLaunchOptions"];
  domSettleTimeoutMs?: number;
  verbose?: BrowserSession["verbose"];
  systemPrompt?: string;
  selfHeal?: boolean;
  waitForCaptchaSolves?: boolean;
  experimental?: boolean;
  actTimeoutMs?: number;
}): BrowserSession {
  return BrowserSessionSchema.parse({
    id: input.id,
    env: input.env,
    status: input.status,
    modelName: input.modelName,
    cdpUrl: input.cdpUrl ?? "ws://stub.invalid/devtools/browser/stub",
    available: input.available,
    browserbaseSessionId: input.browserbaseSessionId,
    browserbaseSessionCreateParams: input.browserbaseSessionCreateParams,
    localBrowserLaunchOptions: input.localBrowserLaunchOptions,
    domSettleTimeoutMs: input.domSettleTimeoutMs,
    verbose: input.verbose,
    systemPrompt: input.systemPrompt,
    selfHeal: input.selfHeal,
    waitForCaptchaSolves: input.waitForCaptchaSolves,
    experimental: input.experimental,
    actTimeoutMs: input.actTimeoutMs,
  });
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

type BrowserSessionActionHandlerContext<TAction extends BrowserSessionAction> =
  {
    stagehand: any;
    params: TAction["params"];
    request: Parameters<RouteHandlerMethod>[0];
    sessionId: string;
    sessionStore: any;
  };

type BrowserSessionActionExecutionResult<TAction extends BrowserSessionAction> =
  {
    result: TAction["result"];
    pageId?: string;
  };

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
  execute: _execute,
  method,
}: {
  actionSchema: z.ZodType<TAction>;
  execute: (
    ctx: BrowserSessionActionHandlerContext<TAction>,
  ) => Promise<BrowserSessionActionExecutionResult<TAction>>;
  method: BrowserSessionActionMethod;
}): RouteHandlerMethod {
  return async (request, reply) => {
    const { params, sessionId } =
      request.body as BrowserSessionRequestBody<TAction>;
    const createdAt = new Date().toISOString();
    const action = actionSchema.parse({
      id: randomUUID(),
      method,
      status: "completed",
      sessionId,
      pageId: getInitialPageId(params),
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

export const browserSessionActionDetailsHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  const { actionId } = request.params as { actionId: string };
  const { sessionId } = request.query as BrowserSessionActionDetailsQuery;
  const createdAt = new Date().toISOString();
  const action = BrowserSessionActionSchema.parse({
    id: actionId,
    method: "pages",
    status: "completed",
    sessionId,
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

export const browserSessionActionListHandler: RouteHandlerMethod = async (
  _request,
  reply,
) => {
  return reply.status(StatusCodes.OK).send({
    success: true,
    error: null,
    actions: [],
  });
};

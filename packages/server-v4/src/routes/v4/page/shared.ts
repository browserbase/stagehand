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

type StubPageResponse = {
  headers(): Record<string, string>;
  ok(): boolean;
  status(): number;
  statusText(): string;
  url(): string;
};

type StubPageFrame = {
  frameId: string;
  isBrowserRemote(): boolean;
  pageId: string;
  sessionId: string;
};

type StubDeepLocator = {
  centroid(): Promise<{ x: number; y: number }>;
  click(options?: unknown): Promise<void>;
  hover(): Promise<void>;
  scrollTo(percentage: number): Promise<void>;
};

type StubInitScript = string | { path?: string; content?: string };

type StubPage = {
  addInitScript(script: StubInitScript): Promise<void>;
  asProtocolFrameTree(rootMainFrameId?: string): unknown;
  click(x: number, y: number, options?: unknown): Promise<string | undefined>;
  close(): Promise<void>;
  deepLocator(selector: string): StubDeepLocator;
  dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: unknown,
  ): Promise<[string | undefined, string | undefined]>;
  enableCursorOverlay(): Promise<void>;
  getFullFrameTree(): unknown;
  getOrdinal(frameId: string): number;
  goBack(options?: unknown): Promise<StubPageResponse | null>;
  goForward(options?: unknown): Promise<StubPageResponse | null>;
  goto(url: string, options?: unknown): Promise<StubPageResponse | null>;
  hover(x: number, y: number, options?: unknown): Promise<string | undefined>;
  keyPress(key: string, options?: unknown): Promise<void>;
  listAllFrameIds(): string[];
  mainFrame(): StubPageFrame;
  mainFrameId(): string;
  reload(options?: unknown): Promise<StubPageResponse | null>;
  screenshot(options?: unknown): Promise<Buffer>;
  scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: unknown,
  ): Promise<string | undefined>;
  sendCDP(method: string, params?: Record<string, unknown>): Promise<unknown>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  setViewportSize(
    width: number,
    height: number,
    options?: unknown,
  ): Promise<void>;
  snapshot(options?: unknown): Promise<{
    formattedTree: string;
    xpathMap: Record<string, string>;
    urlMap: Record<string, string>;
  }>;
  targetId(): string;
  title(): Promise<string>;
  type(text: string, options?: unknown): Promise<void>;
  url(): string;
  waitForLoadState(state?: unknown, timeoutMs?: number): Promise<void>;
  waitForMainLoadState(state?: unknown, timeoutMs?: number): Promise<void>;
  waitForSelector(selector: string, options?: unknown): Promise<boolean>;
  waitForTimeout(ms: number): Promise<void>;
};

type PageActionHandlerContext<TAction extends PageAction> = {
  page: StubPage;
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

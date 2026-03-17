import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { type FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionCreateRequestSchema,
  BrowserSessionErrorResponseSchema,
  BrowserSessionHeadersSchema,
  BrowserSessionResponseSchema,
  type BrowserSessionCreateRequest,
} from "../../../schemas/v4/browserSession.js";
import { buildBrowserSession } from "./shared.js";

const createBrowserSessionHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  const body = request.body as BrowserSessionCreateRequest;
  const env = body.env === "BROWSERBASE" ? "BROWSERBASE" : "LOCAL";
  const cdpUrl = "cdpUrl" in body ? body.cdpUrl : undefined;
  const browserbaseSessionId =
    "browserbaseSessionId" in body ? body.browserbaseSessionId : undefined;
  const browserbaseSessionCreateParams =
    "browserbaseSessionCreateParams" in body
      ? body.browserbaseSessionCreateParams
      : undefined;
  const localBrowserLaunchOptions =
    "localBrowserLaunchOptions" in body
      ? body.localBrowserLaunchOptions
      : undefined;

  return reply.status(StatusCodes.OK).send(
    BrowserSessionResponseSchema.parse({
      success: true,
      data: {
        browserSession: buildBrowserSession({
          id: "session_stub",
          env,
          status: "running",
          modelName: body.modelName,
          cdpUrl:
            env === "LOCAL"
              ? (cdpUrl ?? "ws://stub.invalid/devtools/browser/stub")
              : "ws://stub.invalid/devtools/browser/stub",
          available: false,
          browserbaseSessionId,
          browserbaseSessionCreateParams,
          localBrowserLaunchOptions,
          domSettleTimeoutMs: body.domSettleTimeoutMs,
          verbose: body.verbose,
          systemPrompt: body.systemPrompt,
          selfHeal: body.selfHeal,
          waitForCaptchaSolves: body.waitForCaptchaSolves,
          experimental: body.experimental,
          actTimeoutMs: body.actTimeoutMs,
        }),
      },
    }),
  );
};

const createBrowserSessionRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession",
  schema: {
    operationId: "BrowserSessionCreate",
    summary: "Create a browser session",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionCreateRequestSchema,
    response: {
      200: BrowserSessionResponseSchema,
      400: BrowserSessionErrorResponseSchema,
      401: BrowserSessionErrorResponseSchema,
      500: BrowserSessionErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionHandler,
};

export default createBrowserSessionRoute;

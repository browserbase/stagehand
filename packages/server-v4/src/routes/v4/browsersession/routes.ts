import type { FastifyPluginCallback, RouteOptions } from "fastify";
import { ResponseSerializationError } from "fastify-zod-openapi";
import { StatusCodes } from "http-status-codes";

import browserSessionActionDetailsRoute from "./action/_actionId.js";
import browserSessionActionListRoute from "./action/index.js";
import activePageRoute from "./activePage.js";
import addCookiesRoute from "./addCookies.js";
import addInitScriptRoute from "./addInitScript.js";
import awaitActivePageRoute from "./awaitActivePage.js";
import browserbaseDebugURLRoute from "./browserbaseDebugURL.js";
import browserbaseSessionIDRoute from "./browserbaseSessionID.js";
import browserbaseSessionURLRoute from "./browserbaseSessionURL.js";
import clearCookiesRoute from "./clearCookies.js";
import configuredViewportRoute from "./configuredViewport.js";
import connectURLRoute from "./connectURL.js";
import cookiesRoute from "./cookies.js";
import endBrowserSessionRoute from "./_id/end.js";
import getBrowserSessionRoute from "./_id/index.js";
import getFullFrameTreeByMainFrameIdRoute from "./getFullFrameTreeByMainFrameId.js";
import createBrowserSessionRoute from "./index.js";
import newPageRoute from "./newPage.js";
import pagesRoute from "./pages.js";
import resolvePageByMainFrameIdRoute from "./resolvePageByMainFrameId.js";
import setExtraHTTPHeadersRoute from "./setExtraHTTPHeaders.js";
import { buildBrowserSessionErrorResponse } from "../../../schemas/v4/browserSession.js";

function withTag(route: RouteOptions, tag: string): RouteOptions {
  if (!route.schema) {
    return route;
  }

  return {
    ...route,
    schema: {
      ...route.schema,
      tags: [tag],
    },
  };
}

function normalizePluginError(error: unknown): {
  errorMessage: string;
  statusCode: number;
} {
  if ((error as { validation?: unknown[] }).validation) {
    return {
      errorMessage: "Request validation failed",
      statusCode: StatusCodes.BAD_REQUEST,
    };
  }

  if (error instanceof ResponseSerializationError) {
    return {
      errorMessage: "Response validation failed",
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    };
  }

  return {
    errorMessage: error instanceof Error ? error.message : String(error),
    statusCode:
      (error as { statusCode?: number }).statusCode ??
      StatusCodes.INTERNAL_SERVER_ERROR,
  };
}

const rawBrowserSessionRoutes: RouteOptions[] = [
  createBrowserSessionRoute,
  getBrowserSessionRoute,
  endBrowserSessionRoute,
  addInitScriptRoute,
  setExtraHTTPHeadersRoute,
  pagesRoute,
  activePageRoute,
  awaitActivePageRoute,
  resolvePageByMainFrameIdRoute,
  getFullFrameTreeByMainFrameIdRoute,
  newPageRoute,
  cookiesRoute,
  addCookiesRoute,
  clearCookiesRoute,
  connectURLRoute,
  configuredViewportRoute,
  browserbaseSessionIDRoute,
  browserbaseSessionURLRoute,
  browserbaseDebugURLRoute,
  browserSessionActionListRoute,
  browserSessionActionDetailsRoute,
];

export const browserSessionRoutes: RouteOptions[] = rawBrowserSessionRoutes.map(
  (route) => withTag(route, "browserSession"),
);

export const browserSessionRoutesPlugin: FastifyPluginCallback = (
  instance,
  _opts,
  done,
) => {
  instance.setErrorHandler((error, _request, reply) => {
    const { errorMessage, statusCode } = normalizePluginError(error);

    return reply.status(statusCode).send(
      buildBrowserSessionErrorResponse({
        error: errorMessage,
        statusCode,
        stack: error instanceof Error ? (error.stack ?? null) : null,
      }),
    );
  });

  for (const route of browserSessionRoutes) {
    instance.route(route);
  }

  done();
};

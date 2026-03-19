import type { FastifyPluginCallback, RouteOptions } from "fastify";

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
import { normalizePluginError, withTag } from "../pluginUtils.js";

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
    const { errorMessage, stack, statusCode } = normalizePluginError(error);

    return reply.status(statusCode).send(
      buildBrowserSessionErrorResponse({
        error: errorMessage,
        statusCode,
        stack,
      }),
    );
  });

  for (const route of browserSessionRoutes) {
    instance.route(route);
  }

  done();
};

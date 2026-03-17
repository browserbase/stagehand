import type { RouteOptions } from "fastify";

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

export const browserSessionRoutes: RouteOptions[] = [
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

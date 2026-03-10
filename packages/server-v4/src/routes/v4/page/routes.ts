import type { RouteOptions } from "fastify";

import pageActionDetailsRoute from "./action/_actionId.js";
import pageActionListRoute from "./action/index.js";
import evaluateRoute from "./evaluate.js";
import { interactionRoutes } from "./interactions.js";
import { metadataRoutes } from "./metadata.js";
import { navigationRoutes } from "./navigation.js";
import screenshotRoute from "./screenshot.js";
import sendCDPRoute from "./sendCDP.js";
import setViewportSizeRoute from "./setViewportSize.js";
import snapshotRoute from "./snapshot.js";
import waitForLoadStateRoute from "./waitForLoadState.js";
import waitForSelectorRoute from "./waitForSelector.js";
import waitForTimeoutRoute from "./waitForTimeout.js";

export const pageRoutes: RouteOptions[] = [
  ...interactionRoutes,
  ...navigationRoutes,
  ...metadataRoutes,
  screenshotRoute,
  snapshotRoute,
  setViewportSizeRoute,
  waitForLoadStateRoute,
  waitForSelectorRoute,
  waitForTimeoutRoute,
  evaluateRoute,
  sendCDPRoute,
  pageActionListRoute,
  pageActionDetailsRoute,
];

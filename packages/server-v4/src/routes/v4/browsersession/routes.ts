import type { RouteOptions } from "fastify";

import createBrowserSessionRoute from "./index.js";
import endBrowserSessionRoute from "./_id/end.js";
import getBrowserSessionRoute from "./_id/index.js";

export const browserSessionRoutes: RouteOptions[] = [
  createBrowserSessionRoute,
  getBrowserSessionRoute,
  endBrowserSessionRoute,
];

import type { RouteOptions } from "fastify";

import actRoute from "./act.js";
import extractRoute from "./extract.js";
import navigateRoute from "./navigate.js";
import observeRoute from "./observe.js";

export const stagehandRoutes: RouteOptions[] = [
  actRoute,
  extractRoute,
  observeRoute,
  navigateRoute,
];

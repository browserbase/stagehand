import type { FastifyPluginCallback, RouteOptions } from "fastify";

import { buildLLMErrorResponse } from "../../../schemas/v4/llm.js";
import { normalizePluginError, withTag } from "../pluginUtils.js";
import getLLMRoute from "./_id/index.js";
import updateLLMRoute from "./_id/update.js";
import createLLMRoute from "./create.js";
import listLLMsRoute from "./index.js";

const rawLLMRoutes: RouteOptions[] = [
  listLLMsRoute,
  createLLMRoute,
  getLLMRoute,
  updateLLMRoute,
];

export const llmRoutes: RouteOptions[] = rawLLMRoutes.map((route) =>
  withTag(route, "llm"),
);

export const llmRoutesPlugin: FastifyPluginCallback = (
  instance,
  _opts,
  done,
) => {
  instance.setErrorHandler((error, _request, reply) => {
    const { errorMessage, statusCode } = normalizePluginError(error);

    return reply.status(statusCode).send(buildLLMErrorResponse(errorMessage));
  });

  for (const route of llmRoutes) {
    instance.route(route);
  }

  done();
};

import type { RouteOptions } from "fastify";
import { z } from "zod/v4";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import { withErrorHandling } from "../lib/errorHandler.js";

const healthcheckRoute: RouteOptions = {
  method: "GET",
  url: "/healthz",
  logLevel: "silent",
  schema: {
    hide: true, // Hide from OpenAPI spec - utility endpoint
    response: {
      200: z
        .object({
          status: z.string(),
          timestamp: z.string(),
        })
        .strict(),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: withErrorHandling(async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }),
};

export default healthcheckRoute;

import type { RouteOptions } from "fastify";

import { withErrorHandling } from "../lib/errorHandler.js";

/* eslint-disable no-magic-numbers */
const healthcheckRoute: RouteOptions = {
  method: "GET",
  url: "/healthz",
  logLevel: "silent",
  schema: {
    response: {
      200: {
        type: "object",
        properties: {
          status: { type: "string" },
          timestamp: { type: "string" },
        },
      },
    },
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  handler: withErrorHandling(async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }),
};

export default healthcheckRoute;

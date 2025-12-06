import type { RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";

import { withErrorHandling } from "../lib/errorHandler.js";

// Server readiness state management
let isReady = false;

/**
 * Get the current readiness state of the server
 * @returns {boolean} Whether the server is ready to accept requests
 */
export const getIsReady = (): boolean => {
  return isReady;
};

/**
 * Mark the server as ready to accept requests
 */
export const setReady = (): void => {
  isReady = true;
};

/**
 * Mark the server as not ready to accept requests
 * Used during graceful shutdown to stop accepting new requests
 */
export const setUnready = (): void => {
  isReady = false;
};

/* eslint-disable no-magic-numbers */
const readinessRoute: RouteOptions = {
  method: "GET",
  url: "/readyz",
  logLevel: "silent",
  schema: {
    response: {
      200: {
        type: "string",
      },
      503: {
        type: "string",
      },
    },
  },
  handler: withErrorHandling(async (_request, reply) => {
    if (!isReady) {
      return reply
        .code(StatusCodes.SERVICE_UNAVAILABLE)
        .send("Service Unavailable");
    }
    return reply.code(StatusCodes.OK).send("Ready");
  }),
};

export default readinessRoute;

import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForTimeoutRequestSchema,
  PageWaitForTimeoutResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const waitForTimeoutRoute: RouteOptions = {
  method: "POST",
  url: "/page/waitForTimeout",
  schema: {
    operationId: "PageWaitForTimeout",
    summary: "page.waitForTimeout",
    body: PageWaitForTimeoutRequestSchema,
    response: {
      200: PageWaitForTimeoutResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/waitForTimeout is not implemented yet",
  ),
};

export default waitForTimeoutRoute;

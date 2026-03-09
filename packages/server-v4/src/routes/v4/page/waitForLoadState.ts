import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForLoadStateRequestSchema,
  PageWaitForLoadStateResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const waitForLoadStateRoute: RouteOptions = {
  method: "POST",
  url: "/page/waitForLoadState",
  schema: {
    operationId: "PageWaitForLoadState",
    summary: "page.waitForLoadState",
    body: PageWaitForLoadStateRequestSchema,
    response: {
      200: PageWaitForLoadStateResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/waitForLoadState is not implemented yet",
  ),
};

export default waitForLoadStateRoute;

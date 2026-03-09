import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForSelectorRequestSchema,
  PageWaitForSelectorResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const waitForSelectorRoute: RouteOptions = {
  method: "POST",
  url: "/page/waitForSelector",
  schema: {
    operationId: "PageWaitForSelector",
    summary: "page.waitForSelector",
    body: PageWaitForSelectorRequestSchema,
    response: {
      200: PageWaitForSelectorResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/waitForSelector is not implemented yet",
  ),
};

export default waitForSelectorRoute;

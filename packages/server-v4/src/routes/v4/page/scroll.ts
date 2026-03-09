import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageScrollRequestSchema,
  PageScrollResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const scrollRoute: RouteOptions = {
  method: "POST",
  url: "/page/scroll",
  schema: {
    operationId: "PageScroll",
    summary: "page.scroll",
    body: PageScrollRequestSchema,
    response: {
      200: PageScrollResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/scroll is not implemented yet",
  ),
};

export default scrollRoute;

import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGoForwardRequestSchema,
  PageGoForwardResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const goForwardRoute: RouteOptions = {
  method: "POST",
  url: "/page/goForward",
  schema: {
    operationId: "PageGoForward",
    summary: "page.goForward",
    body: PageGoForwardRequestSchema,
    response: {
      200: PageGoForwardResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/goForward is not implemented yet",
  ),
};

export default goForwardRoute;

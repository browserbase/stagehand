import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageHoverRequestSchema,
  PageHoverResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const hoverRoute: RouteOptions = {
  method: "POST",
  url: "/page/hover",
  schema: {
    operationId: "PageHover",
    summary: "page.hover",
    body: PageHoverRequestSchema,
    response: {
      200: PageHoverResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/hover is not implemented yet",
  ),
};

export default hoverRoute;

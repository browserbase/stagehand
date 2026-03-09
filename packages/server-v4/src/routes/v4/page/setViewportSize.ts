import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSetViewportSizeRequestSchema,
  PageSetViewportSizeResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const setViewportSizeRoute: RouteOptions = {
  method: "POST",
  url: "/page/setViewportSize",
  schema: {
    operationId: "PageSetViewportSize",
    summary: "page.setViewportSize",
    body: PageSetViewportSizeRequestSchema,
    response: {
      200: PageSetViewportSizeResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/setViewportSize is not implemented yet",
  ),
};

export default setViewportSizeRoute;

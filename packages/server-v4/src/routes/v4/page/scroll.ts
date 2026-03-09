import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageOperations,
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
    ...PageOperations.PageScroll,
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

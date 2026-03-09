import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageClickRequestSchema,
  PageClickResponseSchema,
  PageOperations,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const clickRoute: RouteOptions = {
  method: "POST",
  url: "/page/click",
  schema: {
    ...PageOperations.PageClick,
    body: PageClickRequestSchema,
    response: {
      200: PageClickResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/click is not implemented yet",
  ),
};

export default clickRoute;

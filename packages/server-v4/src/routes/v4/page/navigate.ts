import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageNavigateRequestSchema,
  PageNavigateResponseSchema,
  PageOperations,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const navigateRoute: RouteOptions = {
  method: "POST",
  url: "/page/navigate",
  schema: {
    ...PageOperations.PageNavigate,
    body: PageNavigateRequestSchema,
    response: {
      200: PageNavigateResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/navigate is not implemented yet",
  ),
};

export default navigateRoute;

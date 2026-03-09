import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGoBackRequestSchema,
  PageGoBackResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const goBackRoute: RouteOptions = {
  method: "POST",
  url: "/page/goBack",
  schema: {
    operationId: "PageGoBack",
    summary: "page.goBack",
    body: PageGoBackRequestSchema,
    response: {
      200: PageGoBackResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/goBack is not implemented yet",
  ),
};

export default goBackRoute;

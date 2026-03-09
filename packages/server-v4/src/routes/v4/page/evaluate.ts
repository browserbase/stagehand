import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageEvaluateRequestSchema,
  PageEvaluateResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const evaluateRoute: RouteOptions = {
  method: "POST",
  url: "/page/evaluate",
  schema: {
    operationId: "PageEvaluate",
    summary: "page.evaluate",
    body: PageEvaluateRequestSchema,
    response: {
      200: PageEvaluateResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/evaluate is not implemented yet",
  ),
};

export default evaluateRoute;

import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageCloseRequestSchema,
  PageCloseResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const closeRoute: RouteOptions = {
  method: "POST",
  url: "/page/close",
  schema: {
    operationId: "PageClose",
    summary: "page.close",
    body: PageCloseRequestSchema,
    response: {
      200: PageCloseResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/close is not implemented yet",
  ),
};

export default closeRoute;

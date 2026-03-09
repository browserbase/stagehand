import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGotoRequestSchema,
  PageGotoResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const gotoRoute: RouteOptions = {
  method: "POST",
  url: "/page/goto",
  schema: {
    operationId: "PageGoto",
    summary: "page.goto",
    body: PageGotoRequestSchema,
    response: {
      200: PageGotoResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/goto is not implemented yet",
  ),
};

export default gotoRoute;

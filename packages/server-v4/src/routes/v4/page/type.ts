import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageTypeRequestSchema,
  PageTypeResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const typeRoute: RouteOptions = {
  method: "POST",
  url: "/page/type",
  schema: {
    operationId: "PageType",
    summary: "page.type",
    body: PageTypeRequestSchema,
    response: {
      200: PageTypeResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler("POST /v4/page/type is not implemented yet"),
};

export default typeRoute;

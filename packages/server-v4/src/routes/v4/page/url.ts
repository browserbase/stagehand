import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageUrlRequestSchema,
  PageUrlResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const urlRoute: RouteOptions = {
  method: "POST",
  url: "/page/url",
  schema: {
    operationId: "PageUrl",
    summary: "page.url",
    body: PageUrlRequestSchema,
    response: {
      200: PageUrlResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler("POST /v4/page/url is not implemented yet"),
};

export default urlRoute;

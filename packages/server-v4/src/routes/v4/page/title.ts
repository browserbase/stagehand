import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageTitleRequestSchema,
  PageTitleResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const titleRoute: RouteOptions = {
  method: "POST",
  url: "/page/title",
  schema: {
    operationId: "PageTitle",
    summary: "page.title",
    body: PageTitleRequestSchema,
    response: {
      200: PageTitleResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler("POST /v4/page/title is not implemented yet"),
};

export default titleRoute;

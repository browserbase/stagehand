import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageOperations,
  PageScreenshotRequestSchema,
  PageScreenshotResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const screenshotRoute: RouteOptions = {
  method: "POST",
  url: "/page/screenshot",
  schema: {
    ...PageOperations.PageScreenshot,
    body: PageScreenshotRequestSchema,
    response: {
      200: PageScreenshotResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/screenshot is not implemented yet",
  ),
};

export default screenshotRoute;

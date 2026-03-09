import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageDragAndDropRequestSchema,
  PageDragAndDropResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const dragAndDropRoute: RouteOptions = {
  method: "POST",
  url: "/page/dragAndDrop",
  schema: {
    operationId: "PageDragAndDrop",
    summary: "page.dragAndDrop",
    body: PageDragAndDropRequestSchema,
    response: {
      200: PageDragAndDropResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/dragAndDrop is not implemented yet",
  ),
};

export default dragAndDropRoute;

import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageEnableCursorOverlayActionSchema,
  PageEnableCursorOverlayResultSchema,
  PageEnableCursorOverlayRequestSchema,
  PageEnableCursorOverlayResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const enableCursorOverlayRoute: RouteOptions = {
  method: "POST",
  url: "/page/enableCursorOverlay",
  schema: {
    operationId: "PageEnableCursorOverlay",
    summary: "page.enableCursorOverlay",
    headers: Api.SessionHeadersSchema,
    body: PageEnableCursorOverlayRequestSchema,
    response: {
      200: PageEnableCursorOverlayResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "enableCursorOverlay",
    actionSchema: PageEnableCursorOverlayActionSchema,
    execute: async () => {
      return PageEnableCursorOverlayResultSchema.parse({ enabled: true });
    },
  }),
};

export default enableCursorOverlayRoute;

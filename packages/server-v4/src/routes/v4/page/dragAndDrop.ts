import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageDragAndDropActionSchema,
  PageDragAndDropResultSchema,
  PageDragAndDropRequestSchema,
  PageDragAndDropResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const dragAndDropRoute: RouteOptions = {
  method: "POST",
  url: "/page/dragAndDrop",
  schema: {
    operationId: "PageDragAndDrop",
    summary: "page.dragAndDrop",
    headers: Api.SessionHeadersSchema,
    body: PageDragAndDropRequestSchema,
    response: {
      200: PageDragAndDropResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "dragAndDrop",
    actionSchema: PageDragAndDropActionSchema,
    execute: async () => {
      return PageDragAndDropResultSchema.parse({
        startSelector: {},
        endSelector: {},
      });
    },
  }),
};

export default dragAndDropRoute;

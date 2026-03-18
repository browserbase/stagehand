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
    execute: async ({ params }) => {
      return PageDragAndDropResultSchema.parse({
        fromXpath:
          "xpath" in params.from ? params.from.xpath : "xpath=//stub-from",
        toXpath: "xpath" in params.to ? params.to.xpath : "xpath=//stub-to",
      });
    },
  }),
};

export default dragAndDropRoute;

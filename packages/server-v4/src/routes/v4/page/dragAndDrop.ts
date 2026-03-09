import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageDragAndDropActionSchema,
  PageDragAndDropRequestSchema,
  PageDragAndDropResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  normalizeXPath,
  pageErrorResponses,
} from "./shared.js";

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
    execute: async ({ page, params }) => {
      if ("xpath" in params.from) {
        const from = await page
          .deepLocator(normalizeXPath(params.from.xpath))
          .centroid();
        const to = await page
          .deepLocator(normalizeXPath(params.to.xpath))
          .centroid();

        await page.dragAndDrop(from.x, from.y, to.x, to.y, {
          button: params.button,
          steps: params.steps,
          delay: params.delay,
        });

        return {
          fromXpath: params.from.xpath,
          toXpath: params.to.xpath,
        };
      }

      const [fromXpath, toXpath] = await page.dragAndDrop(
        params.from.x,
        params.from.y,
        params.to.x,
        params.to.y,
        {
          button: params.button,
          steps: params.steps,
          delay: params.delay,
          returnXpath: true,
        },
      );

      return {
        fromXpath: fromXpath || undefined,
        toXpath: toXpath || undefined,
      };
    },
  }),
};

export default dragAndDropRoute;

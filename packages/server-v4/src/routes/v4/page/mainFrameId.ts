import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageMainFrameIdActionSchema,
  PageMainFrameIdRequestSchema,
  PageMainFrameIdResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const mainFrameIdRoute: RouteOptions = {
  method: "POST",
  url: "/page/mainFrameId",
  schema: {
    operationId: "PageMainFrameId",
    summary: "page.mainFrameId",
    headers: Api.SessionHeadersSchema,
    body: PageMainFrameIdRequestSchema,
    response: {
      200: PageMainFrameIdResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "mainFrameId",
    actionSchema: PageMainFrameIdActionSchema,
    execute: async ({ page }) => {
      return { mainFrameId: page.mainFrameId() };
    },
  }),
};

export default mainFrameIdRoute;

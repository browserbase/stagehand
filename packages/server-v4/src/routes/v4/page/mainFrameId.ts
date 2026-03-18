import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageMainFrameIdActionSchema,
  PageMainFrameIdResultSchema,
  PageMainFrameIdRequestSchema,
  PageMainFrameIdResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const mainFrameIdRoute: RouteOptions = {
  method: "GET",
  url: "/page/mainFrameId",
  schema: {
    operationId: "PageMainFrameId",
    summary: "page.mainFrameId",
    headers: Api.SessionHeadersSchema,
    querystring: PageMainFrameIdRequestSchema,
    response: {
      200: PageMainFrameIdResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "mainFrameId",
    actionSchema: PageMainFrameIdActionSchema,
    execute: async () => {
      return PageMainFrameIdResultSchema.parse({ mainFrameId: "frame_stub" });
    },
  }),
};

export default mainFrameIdRoute;

import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageFramesActionSchema,
  PageFramesResultSchema,
  PageFramesRequestSchema,
  PageFramesResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  buildStubPageFrame,
  createPageActionHandler,
  getPageId,
  pageErrorResponses,
} from "./shared.js";

const framesRoute: RouteOptions = {
  method: "GET",
  url: "/page/frames",
  schema: {
    operationId: "PageFrames",
    summary: "page.frames",
    headers: Api.SessionHeadersSchema,
    querystring: PageFramesRequestSchema,
    response: {
      200: PageFramesResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "frames",
    actionSchema: PageFramesActionSchema,
    execute: async ({ params }) => {
      return PageFramesResultSchema.parse({
        frames: [buildStubPageFrame(getPageId(params))],
      });
    },
  }),
};

export default framesRoute;

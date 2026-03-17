import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageFramesActionSchema,
  PageFramesRequestSchema,
  PageFramesResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

type StubFrame = {
  frameId: string;
  pageId: string;
  sessionId: string;
  isBrowserRemote(): boolean;
};

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
    execute: async () => {
      const frames: StubFrame[] = [
        {
          frameId: "frame_stub",
          pageId: "page_stub",
          sessionId: "session_stub",
          isBrowserRemote: () => false,
        },
      ];

      return {
        frames: frames.map((frame) => ({
          frameId: frame.frameId,
          pageId: frame.pageId,
          sessionId: frame.sessionId,
          isBrowserRemote: frame.isBrowserRemote(),
        })),
      };
    },
  }),
};

export default framesRoute;

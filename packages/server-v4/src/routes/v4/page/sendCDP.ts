import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSendCDPActionSchema,
  PageSendCDPResultSchema,
  PageSendCDPRequestSchema,
  PageSendCDPResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const sendCDPRoute: RouteOptions = {
  method: "POST",
  url: "/page/sendCDP",
  schema: {
    operationId: "PageSendCDP",
    summary: "page.sendCDP",
    headers: Api.SessionHeadersSchema,
    body: PageSendCDPRequestSchema,
    response: {
      200: PageSendCDPResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "sendCDP",
    actionSchema: PageSendCDPActionSchema,
    execute: async ({ params }) => {
      return PageSendCDPResultSchema.parse({
        value: {
          method: params.method,
          params: params.params ?? null,
        },
      });
    },
  }),
};

export default sendCDPRoute;

import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSendCDPActionSchema,
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
    execute: async ({ page, params }) => {
      if (
        params.params !== undefined &&
        (typeof params.params !== "object" ||
          params.params === null ||
          Array.isArray(params.params))
      ) {
        throw new Error("CDP params must be an object");
      }

      const value = await page.sendCDP(
        params.method,
        params.params as Record<string, unknown> | undefined,
      );

      return { value };
    },
  }),
};

export default sendCDPRoute;

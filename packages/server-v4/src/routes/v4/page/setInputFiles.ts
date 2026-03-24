import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSetInputFilesActionSchema,
  PageSetInputFilesRequestSchema,
  PageSetInputFilesResponseSchema,
  PageSetInputFilesResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const setInputFilesRoute: RouteOptions = {
  method: "POST",
  url: "/page/setInputFiles",
  schema: {
    operationId: "PageSetInputFiles",
    summary: "page.setInputFiles",
    headers: Api.SessionHeadersSchema,
    body: PageSetInputFilesRequestSchema,
    response: {
      200: PageSetInputFilesResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "setInputFiles",
    actionSchema: PageSetInputFilesActionSchema,
    execute: async () => {
      return PageSetInputFilesResultSchema.parse({ selector: {}, files: [] });
    },
  }),
};

export default setInputFilesRoute;

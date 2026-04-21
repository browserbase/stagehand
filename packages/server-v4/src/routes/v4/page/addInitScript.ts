import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageAddInitScriptActionSchema,
  PageAddInitScriptResultSchema,
  PageAddInitScriptRequestSchema,
  PageAddInitScriptResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const addInitScriptRoute: RouteOptions = {
  method: "POST",
  url: "/page/addInitScript",
  schema: {
    operationId: "PageAddInitScript",
    summary: "page.addInitScript",
    headers: Api.SessionHeadersSchema,
    body: PageAddInitScriptRequestSchema,
    response: {
      200: PageAddInitScriptResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "addInitScript",
    actionSchema: PageAddInitScriptActionSchema,
    execute: async () => {
      return PageAddInitScriptResultSchema.parse({ added: true });
    },
  }),
};

export default addInitScriptRoute;

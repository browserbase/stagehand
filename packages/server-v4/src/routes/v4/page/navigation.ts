import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageCloseActionSchema,
  PageCloseRequestSchema,
  PageCloseResponseSchema,
  PageGoBackActionSchema,
  PageGoBackRequestSchema,
  PageGoBackResponseSchema,
  PageGoForwardActionSchema,
  PageGoForwardRequestSchema,
  PageGoForwardResponseSchema,
  PageGotoActionSchema,
  PageGotoRequestSchema,
  PageGotoResponseSchema,
  PageReloadActionSchema,
  PageReloadRequestSchema,
  PageReloadResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

export const navigationRoutes: RouteOptions[] = [
  {
    method: "POST",
    url: "/page/goto",
    schema: {
      operationId: "PageGoto",
      summary: "page.goto",
      headers: Api.SessionHeadersSchema,
      body: PageGotoRequestSchema,
      response: {
        200: PageGotoResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "goto",
      actionSchema: PageGotoActionSchema,
      execute: async ({ page, params }) => {
        const response = await page.goto(params.url, {
          waitUntil: params.waitUntil,
          timeoutMs: params.timeoutMs,
        });

        return {
          url: page.url(),
          response: response
            ? {
                url: response.url(),
                status: response.status(),
                statusText: response.statusText(),
                ok: response.ok(),
                headers: response.headers(),
              }
            : null,
        };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/reload",
    schema: {
      operationId: "PageReload",
      summary: "page.reload",
      headers: Api.SessionHeadersSchema,
      body: PageReloadRequestSchema,
      response: {
        200: PageReloadResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "reload",
      actionSchema: PageReloadActionSchema,
      execute: async ({ page, params }) => {
        const response = await page.reload({
          waitUntil: params.waitUntil,
          timeoutMs: params.timeoutMs,
          ignoreCache: params.ignoreCache,
        });

        return {
          url: page.url(),
          response: response
            ? {
                url: response.url(),
                status: response.status(),
                statusText: response.statusText(),
                ok: response.ok(),
                headers: response.headers(),
              }
            : null,
        };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/goBack",
    schema: {
      operationId: "PageGoBack",
      summary: "page.goBack",
      headers: Api.SessionHeadersSchema,
      body: PageGoBackRequestSchema,
      response: {
        200: PageGoBackResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "goBack",
      actionSchema: PageGoBackActionSchema,
      execute: async ({ page, params }) => {
        const response = await page.goBack({
          waitUntil: params.waitUntil,
          timeoutMs: params.timeoutMs,
        });

        return {
          url: page.url(),
          response: response
            ? {
                url: response.url(),
                status: response.status(),
                statusText: response.statusText(),
                ok: response.ok(),
                headers: response.headers(),
              }
            : null,
        };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/goForward",
    schema: {
      operationId: "PageGoForward",
      summary: "page.goForward",
      headers: Api.SessionHeadersSchema,
      body: PageGoForwardRequestSchema,
      response: {
        200: PageGoForwardResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "goForward",
      actionSchema: PageGoForwardActionSchema,
      execute: async ({ page, params }) => {
        const response = await page.goForward({
          waitUntil: params.waitUntil,
          timeoutMs: params.timeoutMs,
        });

        return {
          url: page.url(),
          response: response
            ? {
                url: response.url(),
                status: response.status(),
                statusText: response.statusText(),
                ok: response.ok(),
                headers: response.headers(),
              }
            : null,
        };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/close",
    schema: {
      operationId: "PageClose",
      summary: "page.close",
      headers: Api.SessionHeadersSchema,
      body: PageCloseRequestSchema,
      response: {
        200: PageCloseResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "close",
      actionSchema: PageCloseActionSchema,
      execute: async ({ page }) => {
        await page.close();
        return { closed: true };
      },
    }),
  },
];

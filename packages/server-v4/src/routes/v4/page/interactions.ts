import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageClickActionSchema,
  PageClickRequestSchema,
  PageClickResponseSchema,
  PageDragAndDropActionSchema,
  PageDragAndDropRequestSchema,
  PageDragAndDropResponseSchema,
  PageHoverActionSchema,
  PageHoverRequestSchema,
  PageHoverResponseSchema,
  PageKeyPressActionSchema,
  PageKeyPressRequestSchema,
  PageKeyPressResponseSchema,
  PageScrollActionSchema,
  PageScrollRequestSchema,
  PageScrollResponseSchema,
  PageTypeActionSchema,
  PageTypeRequestSchema,
  PageTypeResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  normalizeXPath,
  pageErrorResponses,
} from "./shared.js";

export const interactionRoutes: RouteOptions[] = [
  {
    method: "POST",
    url: "/page/click",
    schema: {
      operationId: "PageClick",
      summary: "page.click",
      headers: Api.SessionHeadersSchema,
      body: PageClickRequestSchema,
      response: {
        200: PageClickResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "click",
      actionSchema: PageClickActionSchema,
      execute: async ({ page, params }) => {
        if ("selector" in params) {
          await page.deepLocator(normalizeXPath(params.selector.xpath)).click({
            button: params.button,
            clickCount: params.clickCount,
          });

          return { xpath: params.selector.xpath };
        }

        const xpath = await page.click(params.x, params.y, {
          button: params.button,
          clickCount: params.clickCount,
          returnXpath: true,
        });

        return { xpath: xpath || undefined };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/hover",
    schema: {
      operationId: "PageHover",
      summary: "page.hover",
      headers: Api.SessionHeadersSchema,
      body: PageHoverRequestSchema,
      response: {
        200: PageHoverResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "hover",
      actionSchema: PageHoverActionSchema,
      execute: async ({ page, params }) => {
        if ("selector" in params) {
          await page.deepLocator(normalizeXPath(params.selector.xpath)).hover();
          return { xpath: params.selector.xpath };
        }

        const xpath = await page.hover(params.x, params.y, {
          returnXpath: true,
        });

        return { xpath: xpath || undefined };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/scroll",
    schema: {
      operationId: "PageScroll",
      summary: "page.scroll",
      headers: Api.SessionHeadersSchema,
      body: PageScrollRequestSchema,
      response: {
        200: PageScrollResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "scroll",
      actionSchema: PageScrollActionSchema,
      execute: async ({ page, params }) => {
        if ("selector" in params) {
          await page
            .deepLocator(normalizeXPath(params.selector.xpath))
            .scrollTo(params.percentage);

          return { xpath: params.selector.xpath };
        }

        const xpath = await page.scroll(
          params.x,
          params.y,
          params.deltaX ?? 0,
          params.deltaY,
          { returnXpath: true },
        );

        return { xpath: xpath || undefined };
      },
    }),
  },
  {
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
        if ("xpath" in params.from && "xpath" in params.to) {
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

        const fromPoint = params.from as { x: number; y: number };
        const toPoint = params.to as { x: number; y: number };
        const [fromXpath, toXpath] = await page.dragAndDrop(
          fromPoint.x,
          fromPoint.y,
          toPoint.x,
          toPoint.y,
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
  },
  {
    method: "POST",
    url: "/page/type",
    schema: {
      operationId: "PageType",
      summary: "page.type",
      headers: Api.SessionHeadersSchema,
      body: PageTypeRequestSchema,
      response: {
        200: PageTypeResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "type",
      actionSchema: PageTypeActionSchema,
      execute: async ({ page, params }) => {
        await page.type(params.text, {
          delay: params.delay,
          withMistakes: params.withMistakes,
        });

        return { text: params.text };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/keyPress",
    schema: {
      operationId: "PageKeyPress",
      summary: "page.keyPress",
      headers: Api.SessionHeadersSchema,
      body: PageKeyPressRequestSchema,
      response: {
        200: PageKeyPressResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "keyPress",
      actionSchema: PageKeyPressActionSchema,
      execute: async ({ page, params }) => {
        await page.keyPress(params.key, {
          delay: params.delay,
        });

        return { key: params.key };
      },
    }),
  },
];

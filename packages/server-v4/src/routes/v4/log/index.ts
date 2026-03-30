import type { RouteHandlerMethod, RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { getEventStore, type EventStoreQuery } from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";

import { success } from "../../../lib/response.js";
import {
  LogErrorResponseSchema,
  LogQuerySchema,
  LogResponseSchema,
  type LogQuery,
} from "../../../schemas/v4/log.js";

function buildEventStoreQuery(query: LogQuery): EventStoreQuery {
  return {
    sessionId: query.sessionId,
    eventId: query.eventId,
    eventType: query.eventType,
    limit: query.limit,
  };
}

function openSse(reply: Parameters<RouteHandlerMethod>[1]): void {
  reply.raw.writeHead(StatusCodes.OK, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });
}

const logRouteHandler: RouteHandlerMethod = async (request, reply) => {
  const query = request.query as LogQuery;
  const eventStore = getEventStore();
  const eventQuery = buildEventStoreQuery(query);

  if (query.follow) {
    openSse(reply);

    const events = await eventStore.listEvents(eventQuery);
    for (const eventRecord of events) {
      reply.raw.write(`data: ${JSON.stringify(eventRecord)}\n\n`);
    }

    const unsubscribe = eventStore.subscribe(
      {
        ...eventQuery,
        limit: undefined,
      },
      (eventRecord: unknown) => {
        reply.raw.write(`data: ${JSON.stringify(eventRecord)}\n\n`);
      },
    );

    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15_000);
    heartbeat.unref();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);
    return reply;
  }

  const events = await eventStore.listEvents(eventQuery);
  return success(reply, { events });
};

const logRoute: RouteOptions = {
  method: "GET",
  url: "/log",
  schema: {
    operationId: "LogList",
    summary: "Query or follow flow logger events",
    querystring: LogQuerySchema,
    response: {
      200: LogResponseSchema,
      400: LogErrorResponseSchema,
      401: LogErrorResponseSchema,
      500: LogErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: logRouteHandler,
};

export default logRoute;

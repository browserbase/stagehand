import { randomUUID } from "crypto";

import type { FastifyReply } from "fastify";

import type { V4Runtime } from "../../v4/runtime.js";
import type { V4ResponseEnvelope } from "../../v4/types.js";

export function resolveRequestId(body: unknown): string {
  if (body && typeof body === "object") {
    const maybeId = (body as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.length > 0) {
      return maybeId;
    }
  }

  return randomUUID();
}

export function buildMetadata(runtime: V4Runtime): V4ResponseEnvelope["metadata"] {
  return {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    version: "v4",
    serviceMode: {
      understudy: runtime.config.understudyMode,
    },
  };
}

export function sendV4Success<TResult>(
  reply: FastifyReply,
  options: {
    runtime: V4Runtime;
    id: string;
    result: TResult;
    statusCode?: number;
  },
): FastifyReply {
  const payload: V4ResponseEnvelope<TResult> = {
    id: options.id,
    error: null,
    result: options.result,
    metadata: buildMetadata(options.runtime),
  };

  return reply.status(options.statusCode ?? 200).send(payload);
}

export function sendV4Error(
  reply: FastifyReply,
  options: {
    runtime: V4Runtime;
    id: string;
    message: string;
    statusCode?: number;
    code?: string;
    details?: unknown;
  },
): FastifyReply {
  const payload: V4ResponseEnvelope<Record<string, never>> = {
    id: options.id,
    error: {
      message: options.message,
      code: options.code,
      details: options.details,
    },
    result: {},
    metadata: buildMetadata(options.runtime),
  };

  return reply.status(options.statusCode ?? 400).send(payload);
}

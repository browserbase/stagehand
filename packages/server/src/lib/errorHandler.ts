import type {
  FastifyReply,
  FastifyRequest,
  RouteGenericInterface,
} from "fastify";
import { StatusCodes } from "http-status-codes";

import { error } from "./response.js";

export class AppError extends Error {
  statusCode: number;
  isInternal: boolean;

  constructor(
    message: string,
    statusCode = StatusCodes.BAD_REQUEST,
    isInternal = false,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isInternal = isInternal;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get the message safe to send to clients.
   * For internal errors (5xx), returns generic message.
   * For client errors (4xx), returns actual message.
   */
  getClientMessage(): string {
    if (this.isInternal) {
      return this.statusCode >= StatusCodes.INTERNAL_SERVER_ERROR
        ? "An internal server error occurred"
        : "An error occurred while processing your request";
    }
    return this.message;
  }
}

/**
 * Wraps a route handler with error handling
 * @param handler The route handler to wrap
 * @returns A wrapped route handler that catches errors
 */
export function withErrorHandling<
  T extends RouteGenericInterface = RouteGenericInterface,
  R = unknown,
>(handler: (request: FastifyRequest<T>, reply: FastifyReply) => Promise<R>) {
  return async (
    request: FastifyRequest<T>,
    reply: FastifyReply,
  ): Promise<R | FastifyReply> => {
    try {
      return await handler(request, reply);
    } catch (err) {
      request.log.error(err);

      if (err instanceof AppError) {
        return error(reply, err.getClientMessage(), err.statusCode);
      }

      return error(
        reply,
        "An unexpected error occurred",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }
  };
}

import type { FastifyReply } from "fastify";
import { StatusCodes } from "http-status-codes";

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  message: string;
}

type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export function success<T>(
  reply: FastifyReply,
  data: T,
  status = StatusCodes.OK,
): FastifyReply {
  return reply.status(status).send({
    success: true,
    data,
  });
}

export function error(
  reply: FastifyReply,
  message: string,
  status = StatusCodes.BAD_REQUEST,
): FastifyReply {
  return reply.status(status).send({
    success: false,
    message,
  });
}

export function isSuccessResponse<T>(
  response: ApiResponse<T>,
): response is SuccessResponse<T> {
  return response.success;
}

export function isErrorResponse(
  response: ApiResponse<unknown>,
): response is ErrorResponse {
  return !response.success;
}

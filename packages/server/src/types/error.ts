import { StatusCodes } from "http-status-codes";

import { AppError } from "../lib/errorHandler.js";

export class UnknownModelError extends AppError {
  constructor(model: string) {
    super(`Unknown model: ${model}`, StatusCodes.BAD_REQUEST);
  }
}
export class InvalidProviderError extends AppError {
  constructor(provider: string) {
    super(`Invalid provider: ${provider}`, StatusCodes.BAD_REQUEST);
  }
}

export class InvalidModelError extends AppError {
  constructor(model: string) {
    super(`Invalid model: ${model}`, StatusCodes.BAD_REQUEST);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super("Unauthorized", StatusCodes.UNAUTHORIZED);
  }
}

export class MissingHeaderError extends AppError {
  constructor(header: string) {
    super(`Missing required header: ${header}`, StatusCodes.BAD_REQUEST);
  }
}

export class InvalidAPIKeyError extends AppError {
  constructor(provider: string) {
    super(`Invalid API key for provider: ${provider}`, StatusCodes.BAD_REQUEST);
  }
}

export class AttemptedCloseOnNonActiveSessionError extends AppError {
  constructor() {
    super(
      "Attempted to close session that is not currently active",
      StatusCodes.CONFLICT,
    );
  }
}

interface BrowserbaseError {
  status?: number;
  statusCode?: number;
  message?: string;
  response?: {
    status?: number;
    data?: {
      message?: string;
    };
  };
}

export class BrowserbaseSDKError extends AppError {
  constructor(error: unknown, defaultMessage: string) {
    const browserbaseError = error as BrowserbaseError;
    const {
      message: errMessage,
      status,
      statusCode: errStatusCode,
      response,
    } = browserbaseError;

    let message = defaultMessage;
    let finalStatusCode = StatusCodes.BAD_REQUEST;

    // Extract message from error
    if (errMessage) {
      message = errMessage;
    } else if (response?.data?.message) {
      ({ message } = response.data);
    }

    // Extract status code from error
    if (status && typeof status === "number") {
      finalStatusCode = status as StatusCodes;
    } else if (errStatusCode && typeof errStatusCode === "number") {
      finalStatusCode = errStatusCode as StatusCodes;
    } else if (response?.status && typeof response.status === "number") {
      finalStatusCode = response.status as StatusCodes;
    }

    // Check for specific session error
    if (message.includes("is not running")) {
      throw new AttemptedCloseOnNonActiveSessionError();
    }

    // Mark 5xx errors as internal to sanitize sensitive details
    const isInternal =
      Number(finalStatusCode) >= Number(StatusCodes.INTERNAL_SERVER_ERROR);

    super(message, finalStatusCode, isInternal);
  }
}

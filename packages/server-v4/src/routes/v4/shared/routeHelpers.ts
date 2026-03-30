import { StatusCodes } from "http-status-codes";

import { AppError } from "../../../lib/errorHandler.js";

type ErrorClassifierOptions = {
  sessionNotFoundMessage?: string;
  notFoundMessages?: string[];
  notFoundNames?: string[];
  badRequestMessages?: string[];
  badRequestNames?: string[];
  unprocessableEntityNames?: string[];
  useAppErrorStatus?: boolean;
  nameMessageOverrides?: Record<string, string>;
};

export type ClassifiedRouteError = {
  message: string;
  statusCode: number;
};

const COMMON_BAD_REQUEST_ERROR_NAMES = new Set([
  "StagehandInvalidArgumentError",
  "StagehandMissingArgumentError",
  "StagehandEvalError",
  "StagehandLocatorError",
]);

export class ActionRouteError<TAction = unknown> extends Error {
  action: TAction;
  cause: unknown;

  constructor(cause: unknown, action: TAction) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ActionRouteError";
    this.action = action;
    this.cause = cause;
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
  }
}

function unwrapRouteError(error: unknown): unknown {
  return error instanceof ActionRouteError ? error.cause : error;
}

export function getRouteErrorStack(error: unknown): string | null {
  const cause = unwrapRouteError(error);
  return cause instanceof Error ? (cause.stack ?? null) : null;
}

export function getActionRouteErrorAction<TAction>(
  error: unknown,
): TAction | undefined {
  return error instanceof ActionRouteError
    ? (error.action as TAction)
    : undefined;
}

export function classifyRouteError(
  error: unknown,
  options: ErrorClassifierOptions = {},
): ClassifiedRouteError {
  const cause = unwrapRouteError(error);
  const message = cause instanceof Error ? cause.message : String(cause);
  const name = cause instanceof Error ? cause.name : "";

  if (message === "Unauthorized") {
    return {
      message,
      statusCode: StatusCodes.UNAUTHORIZED,
    };
  }

  if (
    message.startsWith("Session not found:") ||
    message.startsWith("Session expired:")
  ) {
    return {
      message: options.sessionNotFoundMessage ?? "Session not found",
      statusCode: StatusCodes.NOT_FOUND,
    };
  }

  if (options.notFoundMessages?.includes(message)) {
    return {
      message,
      statusCode: StatusCodes.NOT_FOUND,
    };
  }

  if (options.badRequestMessages?.includes(message)) {
    return {
      message,
      statusCode: StatusCodes.BAD_REQUEST,
    };
  }

  if (options.notFoundNames?.includes(name)) {
    return {
      message: options.nameMessageOverrides?.[name] ?? message,
      statusCode: StatusCodes.NOT_FOUND,
    };
  }

  if (options.unprocessableEntityNames?.includes(name)) {
    return {
      message,
      statusCode: StatusCodes.UNPROCESSABLE_ENTITY,
    };
  }

  if (name === "TimeoutError" || name.endsWith("TimeoutError")) {
    return {
      message,
      statusCode: StatusCodes.REQUEST_TIMEOUT,
    };
  }

  if (
    COMMON_BAD_REQUEST_ERROR_NAMES.has(name) ||
    options.badRequestNames?.includes(name)
  ) {
    return {
      message,
      statusCode: StatusCodes.BAD_REQUEST,
    };
  }

  if (options.useAppErrorStatus && cause instanceof AppError) {
    return {
      message,
      statusCode: cause.statusCode,
    };
  }

  return {
    message,
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
  };
}

export function classifyPageRouteError(error: unknown): ClassifiedRouteError {
  return classifyRouteError(error, {
    badRequestMessages: ["CDP params must be an object"],
    notFoundMessages: ["Page not found"],
    notFoundNames: ["StagehandElementNotFoundError"],
    unprocessableEntityNames: ["ElementNotVisibleError"],
  });
}

export function classifyBrowserSessionMethodRouteError(
  error: unknown,
): ClassifiedRouteError {
  return classifyRouteError(error, {
    badRequestNames: [
      "CookieSetError",
      "CookieValidationError",
      "StagehandSetExtraHTTPHeadersError",
    ],
    notFoundNames: ["PageNotFoundError"],
    sessionNotFoundMessage: "Browser session not found",
  });
}

export function classifyBrowserSessionLifecycleRouteError(
  error: unknown,
): ClassifiedRouteError {
  return classifyRouteError(error, {
    sessionNotFoundMessage: "Browser session not found",
    useAppErrorStatus: true,
  });
}

export function classifyStagehandRouteError(
  error: unknown,
): ClassifiedRouteError {
  return classifyRouteError(error, {
    notFoundMessages: ["Page not found"],
    notFoundNames: ["PageNotFoundError"],
    useAppErrorStatus: true,
  });
}

export function classifyLogRouteError(error: unknown): ClassifiedRouteError {
  return classifyRouteError(error, {
    useAppErrorStatus: true,
  });
}

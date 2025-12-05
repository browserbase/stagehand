import { randomUUID } from "crypto";
import type { V3 } from "../v3";
import type { SessionStore, RequestContext } from "./SessionStore";

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Standard error codes for Stagehand API errors.
 */
export enum StagehandErrorCode {
  // User-actionable errors (400)
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  MISSING_ARGUMENT = "MISSING_ARGUMENT",
  INVALID_MODEL = "INVALID_MODEL",
  INVALID_SCHEMA = "INVALID_SCHEMA",
  EXPERIMENTAL_NOT_CONFIGURED = "EXPERIMENTAL_NOT_CONFIGURED",

  // Operational errors (422)
  ELEMENT_NOT_FOUND = "ELEMENT_NOT_FOUND",
  ACTION_FAILED = "ACTION_FAILED",
  LLM_ERROR = "LLM_ERROR",
  TIMEOUT = "TIMEOUT",

  // Internal errors (500)
  SDK_ERROR = "SDK_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Structured error response for Stagehand API.
 */
export interface StagehandErrorResponse {
  error: string;
  code: StagehandErrorCode;
  operation?: string;
  statusCode: number;
}

// Error name to code mappings for user-actionable errors (400)
const USER_ERROR_MAP: Record<string, StagehandErrorCode> = {
  StagehandInvalidArgumentError: StagehandErrorCode.INVALID_ARGUMENT,
  StagehandMissingArgumentError: StagehandErrorCode.MISSING_ARGUMENT,
  MissingLLMConfigurationError: StagehandErrorCode.INVALID_MODEL,
  UnsupportedModelError: StagehandErrorCode.INVALID_MODEL,
  UnsupportedModelProviderError: StagehandErrorCode.INVALID_MODEL,
  InvalidAISDKModelFormatError: StagehandErrorCode.INVALID_MODEL,
  UnsupportedAISDKModelProviderError: StagehandErrorCode.INVALID_MODEL,
  ExperimentalNotConfiguredError: StagehandErrorCode.EXPERIMENTAL_NOT_CONFIGURED,
  ExperimentalApiConflictError: StagehandErrorCode.EXPERIMENTAL_NOT_CONFIGURED,
  CuaModelRequiredError: StagehandErrorCode.INVALID_MODEL,
  AI_APICallError: StagehandErrorCode.INVALID_MODEL,
  APICallError: StagehandErrorCode.INVALID_MODEL,
};

// Operational error mappings (422)
interface OperationalErrorConfig {
  code: StagehandErrorCode;
  sanitize: (msg: string, op: string) => string;
}

const OPERATIONAL_ERROR_MAP: Record<string, OperationalErrorConfig> = {
  StagehandElementNotFoundError: {
    code: StagehandErrorCode.ELEMENT_NOT_FOUND,
    sanitize: (_msg, op) => `Could not find the requested element during ${op}`,
  },
  XPathResolutionError: {
    code: StagehandErrorCode.ELEMENT_NOT_FOUND,
    sanitize: (_msg, op) => `XPath selector did not match any element during ${op}`,
  },
  ElementNotVisibleError: {
    code: StagehandErrorCode.ELEMENT_NOT_FOUND,
    sanitize: (_msg, op) => `Element is not visible during ${op}`,
  },
  StagehandClickError: {
    code: StagehandErrorCode.ACTION_FAILED,
    sanitize: (_msg, op) => `Click action failed during ${op}`,
  },
  StagehandDomProcessError: {
    code: StagehandErrorCode.ACTION_FAILED,
    sanitize: (_msg, op) => `DOM processing failed during ${op}`,
  },
  LLMResponseError: {
    code: StagehandErrorCode.LLM_ERROR,
    sanitize: (_msg, op) => `LLM processing failed during ${op}. Please try again.`,
  },
  CreateChatCompletionResponseError: {
    code: StagehandErrorCode.LLM_ERROR,
    sanitize: (_msg, op) => `LLM request failed during ${op}. Please try again.`,
  },
  CaptchaTimeoutError: {
    code: StagehandErrorCode.TIMEOUT,
    sanitize: (_msg, op) => `Captcha solving timed out during ${op}`,
  },
  TimeoutError: {
    code: StagehandErrorCode.TIMEOUT,
    sanitize: (msg) => msg, // TimeoutError messages are already user-friendly
  },
  ConnectionTimeoutError: {
    code: StagehandErrorCode.TIMEOUT,
    sanitize: (msg) => msg,
  },
};

const MAX_SANITIZED_MESSAGE_LENGTH = 100;

/**
 * Sanitizes error messages to remove potentially sensitive information.
 */
function sanitizeErrorMessage(message: string): string {
  const sanitized = message
    // Remove long alphanumeric strings (potential API keys/tokens)
    .replace(/\b[a-zA-Z0-9_-]{32,}\b/g, "[redacted]")
    // Remove common API key patterns (sk_, pk_, api_, etc.)
    .replace(/\b(?:sk|pk|api|key|token|secret)_[a-zA-Z0-9]{16,}\b/gi, "[api-key]")
    // Remove URLs
    .replace(/https?:\/\/[^\s<>"']+/g, "[url]")
    // Remove Unix-style file paths
    .replace(/(?:^|\s)(\/[\w.-]+){2,}/g, " [path]")
    // Remove Windows-style file paths
    .replace(/[A-Z]:\\[\w\\.-]+/gi, "[path]")
    // Remove emails
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]")
    // Remove IP addresses
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");

  const truncated = sanitized.substring(0, MAX_SANITIZED_MESSAGE_LENGTH);
  return truncated + (sanitized.length > MAX_SANITIZED_MESSAGE_LENGTH ? "..." : "");
}

/**
 * Maps Stagehand SDK errors to structured error responses with appropriate codes and messages.
 */
export function mapStagehandError(err: Error, operation: string): StagehandErrorResponse {
  const errorName = err.constructor.name;
  const { message } = err;

  // User-actionable errors (400) - pass through original message
  const userErrorCode = USER_ERROR_MAP[errorName];
  if (userErrorCode) {
    return {
      error: message,
      code: userErrorCode,
      operation,
      statusCode: 400,
    };
  }

  // Schema validation errors - sanitize to avoid exposing raw data
  if (errorName === "ZodSchemaValidationError") {
    return {
      error: `Schema validation failed during ${operation}`,
      code: StagehandErrorCode.INVALID_SCHEMA,
      operation,
      statusCode: 400,
    };
  }

  // Operational errors (422) - sanitize but provide useful context
  const operationalConfig = OPERATIONAL_ERROR_MAP[errorName];
  if (operationalConfig) {
    return {
      error: operationalConfig.sanitize(message, operation),
      code: operationalConfig.code,
      operation,
      statusCode: 422,
    };
  }

  // Check for StagehandError base class errors that weren't explicitly mapped
  if (errorName.startsWith("Stagehand")) {
    return {
      error: `${operation} operation failed: ${sanitizeErrorMessage(message)}`,
      code: StagehandErrorCode.SDK_ERROR,
      operation,
      statusCode: 500,
    };
  }

  // Unknown errors - hide details completely
  return {
    error: `${operation} operation failed unexpectedly`,
    code: StagehandErrorCode.INTERNAL_ERROR,
    operation,
    statusCode: 500,
  };
}

/**
 * Generic HTTP request interface for streaming.
 * Structurally compatible with FastifyRequest from any version.
 */
export interface StreamingHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/**
 * Generic HTTP reply interface for streaming.
 * Structurally compatible with FastifyReply from any version.
 */
export interface StreamingHttpReply {
  status(code: number): StreamingHttpReply;
  send(payload: unknown): Promise<unknown> | unknown;
  raw: {
    writeHead?(statusCode: number, headers: Record<string, string>): void;
    write(chunk: string | Buffer): boolean;
    end(): void;
    on?(event: string, handler: (...args: unknown[]) => void): unknown;
  };
  sent?: boolean;
  hijack?(): void;
}

export interface StreamingHandlerResult {
  result: unknown;
}

export interface StreamingHandlerContext {
  stagehand: V3;
  sessionId: string;
  request: StreamingHttpRequest;
}

export interface StreamingResponseOptions<T> {
  sessionId: string;
  sessionStore: SessionStore;
  request: StreamingHttpRequest;
  reply: StreamingHttpReply;
  /** The operation name for error reporting (e.g., "act", "extract", "observe") */
  operation: string;
  handler: (ctx: StreamingHandlerContext, data: T) => Promise<StreamingHandlerResult>;
}

/**
 * Sends an SSE (Server-Sent Events) message to the client
 */
function sendSSE(reply: StreamingHttpReply, data: object): void {
  const message = {
    id: randomUUID(),
    ...data,
  };
  reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
}

/**
 * Creates a streaming response handler that sends events via SSE.
 * Extracts RequestContext (modelApiKey, logger) from request headers automatically.
 * Handles errors with proper status codes and sanitized messages.
 */
export async function createStreamingResponse<T>({
  sessionId,
  sessionStore,
  request,
  reply,
  operation,
  handler,
}: StreamingResponseOptions<T>): Promise<void> {
  // Check if streaming is requested
  const streamHeader = request.headers["x-stream-response"];
  const shouldStream = streamHeader === "true";

  // Parse the request body
  const data = request.body as T;

  // Set up SSE response if streaming
  if (shouldStream) {
    reply.raw.writeHead?.(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Transfer-Encoding": "chunked",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Credentials": "true",
    });

    sendSSE(reply, {
      type: "system",
      data: { status: "starting" },
    });
  }

  let result: StreamingHandlerResult | null = null;
  let handlerError: Error | null = null;

  try {
    // Build request context from headers, adding streaming logger if needed
    const requestContext: RequestContext = {
      modelApiKey: request.headers["x-model-api-key"] as string | undefined,
      logger: shouldStream
        ? async (message) => {
            sendSSE(reply, {
              type: "log",
              data: {
                status: "running",
                message,
              },
            });
          }
        : undefined,
    };

    // Get or create the Stagehand instance from the session store
    const stagehand = await sessionStore.getOrCreateStagehand(sessionId, requestContext);

    if (shouldStream) {
      sendSSE(reply, {
        type: "system",
        data: { status: "connected" },
      });
    }

    // Execute the handler
    const ctx: StreamingHandlerContext = {
      stagehand,
      sessionId,
      request,
    };

    result = await handler(ctx, data);
  } catch (err) {
    handlerError = err instanceof Error ? err : new Error("Unknown error occurred");
  }

  // Handle error case
  if (handlerError) {
    const mappedError = mapStagehandError(handlerError, operation);

    if (shouldStream) {
      sendSSE(reply, {
        type: "system",
        data: {
          status: "error",
          error: mappedError.error,
          code: mappedError.code,
        },
      });
      reply.raw.end();
    } else {
      reply.status(mappedError.statusCode).send({
        error: mappedError.error,
        code: mappedError.code,
      });
    }
    return;
  }

  // Handle success case
  if (shouldStream) {
    sendSSE(reply, {
      type: "system",
      data: {
        status: "finished",
        result: result?.result,
      },
    });
    reply.raw.end();
  } else {
    reply.status(200).send({
      result: result?.result,
    });
  }
}

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type {
  ActOptions,
  ActResult,
  ExtractResult,
  ExtractOptions,
  ObserveOptions,
  Action,
  AgentResult,
  ModelConfiguration,
} from "../types/public";
import type { StagehandZodSchema } from "../zodCompat";
import { jsonSchemaToZod, type JsonSchema } from "../../utils";
import type { SessionStore, RequestContext, CreateSessionParams } from "./SessionStore";
import { InMemorySessionStore } from "./InMemorySessionStore";
import { createStreamingResponse, mapStagehandError } from "./stream";

// Re-export error handling utilities for consumers
export { StagehandErrorCode, mapStagehandError } from "./stream";
export type { StagehandErrorResponse } from "./stream";
import {
  ActRequestSchema,
  ActResponseSchema,
  ExtractRequestSchema,
  ExtractResponseSchema,
  ObserveRequestSchema,
  ObserveResponseSchema,
  AgentExecuteRequestSchema,
  AgentExecuteResponseSchema,
  NavigateRequestSchema,
  NavigateResponseSchema,
  SessionStartRequestSchema,
  SessionStartResponseSchema,
  SessionIdParamsSchema,
  SessionEndRequestSchema,
  SessionEndResponseSchema,
  type SessionStartRequest,
  type SessionEndRequest,
  type ActRequest,
  type ExtractRequest,
  type ObserveRequest,
  type AgentExecuteRequest,
  type NavigateRequest,
  type SessionIdParams,
} from "./schemas";

// =============================================================================
// Generic HTTP interfaces for cross-version Fastify compatibility
// =============================================================================

/**
 * Generic HTTP request interface.
 * Structurally compatible with FastifyRequest from any version.
 * @template TBody - Type of the request body (defaults to unknown for backwards compatibility)
 * @template TParams - Type of the route params (defaults to unknown for backwards compatibility)
 */
export interface StagehandHttpRequest<TBody = unknown, TParams = unknown> {
  headers: Record<string, string | string[] | undefined>;
  body: TBody;
  params: TParams;
}

/**
 * Generic HTTP reply interface.
 * Structurally compatible with FastifyReply from any version.
 */
export interface StagehandHttpReply {
  status(code: number): StagehandHttpReply;
  send(payload: unknown): Promise<unknown> | unknown;
  raw: {
    write(chunk: string | Buffer): boolean;
    end(): void;
    on(event: string, handler: (...args: unknown[]) => void): unknown;
  };
  sent: boolean;
  hijack(): void;
}

// Re-export event types for consumers (only LLM events are actually used)
export * from "./events";

// Re-export SessionStore types
export type { SessionStore, RequestContext, CreateSessionParams, SessionStartResult } from "./SessionStore";
export { InMemorySessionStore } from "./InMemorySessionStore";

// Re-export API schemas and types for consumers
export * from "./schemas";

// =============================================================================
// Standalone PreHandler Factory Functions
// =============================================================================

/**
 * Validates the session ID param exists and session is found in SessionStore.
 *
 * This is the core validation logic that can be used by external servers (e.g., cloud API)
 * to share the same validation as the StagehandServer.
 *
 * @param sessionStore - The SessionStore instance to use for validation
 * @param request - The request object (must have params with id)
 * @param reply - The reply object (must have status and send methods)
 * @returns true if validation passed, false if response was sent
 */
export async function validateSession(
  sessionStore: SessionStore,
  request: { params: unknown },
  reply: { status(code: number): { send(payload: unknown): unknown } },
): Promise<boolean> {
  const { id } = request.params as { id?: string };

  if (!id?.length) {
    reply.status(400).send({
      error: "Missing session id",
    });
    return false;
  }

  const hasSession = await sessionStore.hasSession(id);
  if (!hasSession) {
    reply.status(404).send({
      error: "Session not found",
    });
    return false;
  }

  return true;
}

/**
 * Creates a preHandler that validates the session ID param exists and session is found in SessionStore.
 *
 * This factory function can be used by external servers (e.g., cloud API) that want to
 * share the same validation logic as the StagehandServer.
 *
 * @param sessionStore - The SessionStore instance to use for validation
 * @returns A preHandler function compatible with any Fastify version
 *
 * @example
 * ```typescript
 * import { createSessionValidationPreHandler, DBSessionStore } from '@browserbasehq/stagehand/server';
 *
 * const sessionStore = new DBSessionStore();
 * const sessionValidationPreHandler = createSessionValidationPreHandler(sessionStore);
 *
 * app.post('/sessions/:id/act', {
 *   preHandler: [sessionValidationPreHandler],
 * }, handler);
 * ```
 */
export function createSessionValidationPreHandler(
  sessionStore: SessionStore,
): (
  request: { params: unknown },
  reply: { status(code: number): { send(payload: unknown): unknown } },
) => Promise<void> {
  return async (
    request: { params: unknown },
    reply: { status(code: number): { send(payload: unknown): unknown } },
  ): Promise<void> => {
    await validateSession(sessionStore, request, reply);
  };
}

export interface StagehandServerOptions {
  port?: number;
  host?: string;
  /**
   * Session store for managing session lifecycle and V3 instances.
   * Defaults to InMemorySessionStore if not provided.
   * Cloud environments should provide a database-backed implementation.
   */
  sessionStore?: SessionStore;
}

/**
 * StagehandServer - Embedded API server for peer-to-peer Stagehand communication
 *
 * This server implements the same API as the cloud Stagehand API, allowing
 * remote Stagehand instances to connect and execute actions on this machine.
 *
 * Uses a SessionStore interface for session management, allowing cloud environments
 * to provide database-backed implementations for stateless pod architectures.
 */
export class StagehandServer {
  private app: FastifyInstance;
  private sessionStore: SessionStore;
  private port: number;
  private host: string;
  private isListening: boolean = false;

  constructor(options: StagehandServerOptions = {}) {
    this.port = options.port || 3000;
    this.host = options.host || "0.0.0.0";
    this.sessionStore = options.sessionStore ?? new InMemorySessionStore();
    this.app = Fastify({
      logger: false,
    });

    // Set up Zod type provider for automatic request/response validation
    this.app.setValidatorCompiler(validatorCompiler);
    this.app.setSerializerCompiler(serializerCompiler);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Get the session store instance
   */
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  private setupMiddleware(): void {
    this.app.register(cors, {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: "*",
      credentials: true,
    });
  }

  private setupRoutes(): void {
    const app = this.app.withTypeProvider<ZodTypeProvider>();
    const sessionValidationPreHandler = createSessionValidationPreHandler(this.sessionStore);

    // Health check
    app.get("/health", async () => {
      return { status: "ok" };
    });

    // Start session
    app.post(
      "/v1/sessions/start",
      {
        schema: {
          body: SessionStartRequestSchema,
          response: {
            200: SessionStartResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handleStartSession(request, reply);
      },
    );

    // Act endpoint
    app.post(
      "/v1/sessions/:id/act",
      {
        schema: {
          params: SessionIdParamsSchema,
          body: ActRequestSchema,
          response: {
            200: ActResponseSchema,
          },
        },
        preHandler: [sessionValidationPreHandler],
      },
      async (request, reply) => {
        return this.handleAct(request, reply);
      },
    );

    // Extract endpoint
    app.post(
      "/v1/sessions/:id/extract",
      {
        schema: {
          params: SessionIdParamsSchema,
          body: ExtractRequestSchema,
          response: {
            200: ExtractResponseSchema,
          },
        },
        preHandler: [sessionValidationPreHandler],
      },
      async (request, reply) => {
        return this.handleExtract(request, reply);
      },
    );

    // Observe endpoint
    app.post(
      "/v1/sessions/:id/observe",
      {
        schema: {
          params: SessionIdParamsSchema,
          body: ObserveRequestSchema,
          response: {
            200: ObserveResponseSchema,
          },
        },
        preHandler: [sessionValidationPreHandler],
      },
      async (request, reply) => {
        return this.handleObserve(request, reply);
      },
    );

    // Agent execute endpoint
    app.post(
      "/v1/sessions/:id/agentExecute",
      {
        schema: {
          params: SessionIdParamsSchema,
          body: AgentExecuteRequestSchema,
          response: {
            200: AgentExecuteResponseSchema,
          },
        },
        preHandler: [sessionValidationPreHandler],
      },
      async (request, reply) => {
        return this.handleAgentExecute(request, reply);
      },
    );

    // Navigate endpoint
    app.post(
      "/v1/sessions/:id/navigate",
      {
        schema: {
          params: SessionIdParamsSchema,
          body: NavigateRequestSchema,
          response: {
            200: NavigateResponseSchema,
          },
        },
        preHandler: [sessionValidationPreHandler],
      },
      async (request, reply) => {
        return this.handleNavigate(request, reply);
      },
    );

    // End session
    app.post(
      "/v1/sessions/:id/end",
      {
        schema: {
          params: SessionIdParamsSchema,
          body: SessionEndRequestSchema,
          response: {
            200: SessionEndResponseSchema,
          },
        },
        preHandler: [sessionValidationPreHandler],
      },
      async (request, reply) => {
        return this.handleEndSession(request, reply);
      },
    );
  }

  /**
   * Handle /sessions/start - Create new session
   * Body is pre-validated by Fastify using SessionStartRequestSchema
   */
  async handleStartSession(
    request: StagehandHttpRequest<SessionStartRequest>,
    reply: StagehandHttpReply,
  ): Promise<void> {
    try {
      const { body } = request;

      const createParams: CreateSessionParams = {
        modelName: body.modelName,
        verbose: body.verbose,
        systemPrompt: body.systemPrompt,
        selfHeal: body.selfHeal,
        domSettleTimeoutMs: body.domSettleTimeoutMs,
        experimental: body.experimental,
        waitForCaptchaSolves: body.waitForCaptchaSolves,
        browserbaseSessionID: body.browserbaseSessionID ?? body.sessionId,
        browserbaseSessionCreateParams: body.browserbaseSessionCreateParams,
        debugDom: body.debugDom,
        actTimeoutMs: body.actTimeoutMs,
        browserbaseApiKey: request.headers["x-bb-api-key"] as string | undefined,
        browserbaseProjectId: request.headers["x-bb-project-id"] as string | undefined,
        clientLanguage: request.headers["x-language"] as string | undefined,
        sdkVersion: request.headers["x-sdk-version"] as string | undefined,
      };

      const result = await this.sessionStore.startSession(createParams);

      reply.status(200).send({
        success: true,
        data: {
          sessionId: result.sessionId,
          available: result.available,
        },
      });
    } catch (error) {
      const mappedError = mapStagehandError(
        error instanceof Error ? error : new Error("Failed to create session"),
        "startSession",
      );
      reply.status(mappedError.statusCode).send({
        success: false,
        error: mappedError.error,
        code: mappedError.code,
      });
    }
  }

  /**
   * Handle /sessions/:id/act - Execute act command
   * Body is pre-validated by Fastify using ActRequestSchema
   * Session is pre-validated by sessionValidationPreHandler
   */
  async handleAct(
    request: StagehandHttpRequest<ActRequest, SessionIdParams>,
    reply: StagehandHttpReply,
  ): Promise<void> {
    await createStreamingResponse<ActRequest>({
      sessionId: request.params.id,
      sessionStore: this.sessionStore,
      request,
      reply,
      operation: "act",
      handler: async (handlerCtx, data) => {
        const stagehand = handlerCtx.stagehand as any;
        const { frameId } = data;

        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          throw new Error("Page not found");
        }

        const safeOptions: ActOptions = {
          model: data.options?.model
            ? ({
                ...data.options.model,
                modelName: data.options.model.model ?? "gpt-4o",
              } as ModelConfiguration)
            : undefined,
          variables: data.options?.variables,
          timeout: data.options?.timeout,
          page,
        };

        let result: ActResult;
        if (typeof data.input === "string") {
          result = await stagehand.act(data.input, safeOptions);
        } else {
          result = await stagehand.act(data.input as Action, safeOptions);
        }

        return { result };
      },
    });
  }

  /**
   * Handle /sessions/:id/extract - Execute extract command
   * Body is pre-validated by Fastify using ExtractRequestSchema
   * Session is pre-validated by sessionValidationPreHandler
   */
  async handleExtract(
    request: StagehandHttpRequest<ExtractRequest, SessionIdParams>,
    reply: StagehandHttpReply,
  ): Promise<void> {
    await createStreamingResponse<ExtractRequest>({
      sessionId: request.params.id,
      sessionStore: this.sessionStore,
      request,
      reply,
      operation: "extract",
      handler: async (handlerCtx, data) => {
        const stagehand = handlerCtx.stagehand as any;
        const { frameId } = data;

        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          throw new Error("Page not found");
        }

        const safeOptions: ExtractOptions = {
          model: data.options?.model
            ? ({
                ...data.options.model,
                modelName: data.options.model.model ?? "gpt-4o",
              } as ModelConfiguration)
            : undefined,
          timeout: data.options?.timeout,
          selector: data.options?.selector,
          page,
        };

        let result: ExtractResult<StagehandZodSchema>;

        if (data.instruction) {
          if (data.schema) {
            const zodSchema = jsonSchemaToZod(
              data.schema as unknown as JsonSchema,
            ) as StagehandZodSchema;
            result = await stagehand.extract(data.instruction, zodSchema, safeOptions);
          } else {
            result = await stagehand.extract(data.instruction, safeOptions);
          }
        } else {
          result = await stagehand.extract(safeOptions);
        }

        return { result };
      },
    });
  }

  /**
   * Handle /sessions/:id/observe - Execute observe command
   * Body is pre-validated by Fastify using ObserveRequestSchema
   * Session is pre-validated by sessionValidationPreHandler
   */
  async handleObserve(
    request: StagehandHttpRequest<ObserveRequest, SessionIdParams>,
    reply: StagehandHttpReply,
  ): Promise<void> {
    await createStreamingResponse<ObserveRequest>({
      sessionId: request.params.id,
      sessionStore: this.sessionStore,
      request,
      reply,
      operation: "observe",
      handler: async (handlerCtx, data) => {
        const stagehand = handlerCtx.stagehand as any;
        const { frameId } = data;

        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          throw new Error("Page not found");
        }

        const safeOptions: ObserveOptions = {
          model:
            data.options?.model && typeof data.options.model.model === "string"
              ? ({
                  ...data.options.model,
                  modelName: data.options.model.model,
                } as ModelConfiguration)
              : undefined,
          timeout: data.options?.timeout,
          selector: data.options?.selector,
          page,
        };

        let result: Action[];

        if (data.instruction) {
          result = await stagehand.observe(data.instruction, safeOptions);
        } else {
          result = await stagehand.observe(safeOptions);
        }

        return { result };
      },
    });
  }

  /**
   * Handle /sessions/:id/agentExecute - Execute agent command
   * Body is pre-validated by Fastify using AgentExecuteRequestSchema
   * Session is pre-validated by sessionValidationPreHandler
   */
  async handleAgentExecute(
    request: StagehandHttpRequest<AgentExecuteRequest, SessionIdParams>,
    reply: StagehandHttpReply,
  ): Promise<void> {
    await createStreamingResponse<AgentExecuteRequest>({
      sessionId: request.params.id,
      sessionStore: this.sessionStore,
      request,
      reply,
      operation: "agentExecute",
      handler: async (handlerCtx, data) => {
        const stagehand = handlerCtx.stagehand as any;
        const { agentConfig, executeOptions, frameId } = data;

        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          throw new Error("Page not found");
        }

        const fullExecuteOptions = {
          ...executeOptions,
          page,
        };

        const result: AgentResult = await stagehand.agent(agentConfig).execute(fullExecuteOptions);

        return { result };
      },
    });
  }

  /**
   * Handle /sessions/:id/navigate - Navigate to URL
   * Body is pre-validated by Fastify using NavigateRequestSchema
   * Session is pre-validated by sessionValidationPreHandler
   */
  async handleNavigate(
    request: StagehandHttpRequest<NavigateRequest, SessionIdParams>,
    reply: StagehandHttpReply,
  ): Promise<void> {
    await createStreamingResponse<NavigateRequest>({
      sessionId: request.params.id,
      sessionStore: this.sessionStore,
      request,
      reply,
      operation: "navigate",
      handler: async (handlerCtx, data) => {
        const stagehand = handlerCtx.stagehand as any;
        const { url, options, frameId } = data;

        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          throw new Error("Page not found");
        }

        const response = await page.goto(url, options);

        return { result: response };
      },
    });
  }

  /**
   * Handle /sessions/:id/end - End session and cleanup
   * Params are pre-validated by Fastify using SessionIdParamsSchema
   * Session is pre-validated by sessionValidationPreHandler
   */
  async handleEndSession(
    request: StagehandHttpRequest<SessionEndRequest, SessionIdParams>,
    reply: StagehandHttpReply,
  ): Promise<void> {
    try {
      await this.sessionStore.endSession(request.params.id);
      reply.status(200).send({ success: true });
    } catch (error) {
      const mappedError = mapStagehandError(
        error instanceof Error ? error : new Error("Failed to end session"),
        "endSession",
      );
      reply.status(mappedError.statusCode).send({
        error: mappedError.error,
        code: mappedError.code,
      });
    }
  }

  /**
   * Start the server
   */
  async listen(port?: number): Promise<void> {
    const listenPort = port || this.port;

    try {
      await this.app.listen({
        port: listenPort,
        host: this.host,
      });
      this.isListening = true;
      console.log(`Stagehand server listening on http://${this.host}:${listenPort}`);
    } catch (error) {
      console.error("Failed to start server:", error);
      throw error;
    }
  }

  /**
   * Stop the server and cleanup
   */
  async close(): Promise<void> {
    if (this.isListening) {
      await this.app.close();
      this.isListening = false;
    }
    await this.sessionStore.destroy();
  }

  /**
   * Get server URL
   */
  getUrl(): string {
    if (!this.isListening) {
      throw new Error("Server is not listening");
    }
    return `http://${this.host}:${this.port}`;
  }
}
